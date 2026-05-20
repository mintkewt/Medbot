#!/usr/bin/env python3
"""
Ingest UMLS META Parquet into Supabase `knowledge_base`.

Reads pre-exported Parquet (from export-umls-meta-parquet.py), generates
embeddings via Nomic (CUDA/CPU), and upserts into knowledge_base.

Reuses the same embedding contract as the API (`embeddingContract.js`):
  HF path : nomic-ai/nomic-embed-text-v1.5  (or NOMIC_HF_MODEL), dim from EMBEDDING_DIM / EMBED_DIM (default 768)
  OpenRouter: when INGEST_EMBED_PROVIDER=openrouter or EMBEDDING_PROVIDER=openrouter — HTTP embeddings API
  prefix  : NOMIC_DOCUMENT_PREFIX (default: "search_document: ")

Usage:
  python scripts/ingest-umls-meta-parquet.py --parquet data/umls_meta_en_def_optimized.parquet
  python scripts/ingest-umls-meta-parquet.py --parquet data/umls_meta_en_def_optimized.parquet --max-rows 500

Env:
  SUPABASE_URL, SUPABASE_KEY         – optional (ingestion_file_state / idempotency)
  ZILLIZ_ENDPOINT, ZILLIZ_TOKEN      – required (https URL without port → script adds :443; pymilvus default would be :19530)
  ZILLIZ_CONNECT_TIMEOUT             – optional, seconds for Milvus client (default 45)
  ZILLIZ_HTTPS_PORT                  – optional, when https URL has no port (default 443; Zilliz Serverless uses 443)
  INGEST_EMBED_PROVIDER              – optional: openrouter (else HF/torch when unset)
  EMBEDDING_PROVIDER                 – if openrouter, ingest uses OpenRouter unless INGEST_EMBED_PROVIDER overrides
  OPENROUTER_API_KEY                 – required for OpenRouter ingest
  OPENROUTER_EMBED_MODEL             – default nvidia/llama-nemotron-embed-vl-1b-v2:free
  EMBEDDING_DIM, EMBED_DIM           – vector dim (must match Zilliz collection; default 768)
  NOMIC_HF_MODEL                     – HuggingFace model (HF path only)
  NOMIC_DEVICE                       – auto|cuda|cpu (HF path only)
  NOMIC_DOCUMENT_PREFIX              – prefix for embed (default: "search_document: ")
  EMBED_BATCH_SIZE                   – embedding batch size (default: 32)
  INGEST_BATCH_SIZE                  – Zilliz upsert batch (default: 100)
  INGEST_CHECKPOINT_EVERY            – save checkpoint every N rows (default: 500)
  INGEST_RESUME_ENABLED              – 0 to disable resume (default: 1)
  INGEST_MAX_ROWS                    – max Parquet rows to load (default 14000 for ~500MB DB; 0 = all)
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import signal
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse, urlunparse

import pyarrow.parquet as pq
import requests

try:
    from pymilvus import MilvusClient as _PyMilvusClient
except ImportError:
    _PyMilvusClient = None

try:
    from dotenv import load_dotenv
    _env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
    if os.path.isfile(_env_path):
        load_dotenv(_env_path)
except ImportError:
    pass

EMBEDDING_CONTRACT_VERSION = "1"
EMBEDDING_DIM_DEFAULT = 768

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CHECKPOINT_DIR = os.path.join(SCRIPT_DIR, ".cache")
CHECKPOINT_FILE = os.path.join(CHECKPOINT_DIR, "ingest-umls-meta-progress.json")

DEFAULT_PARQUET = os.path.normpath(
    os.path.join(SCRIPT_DIR, "..", "..", "..", "data", "umls_meta_en_def_optimized.parquet")
)


def _default_ingest_max_rows() -> int:
    """Cap rows for small Supabase tiers (~500MB total DB). 0 = ingest entire Parquet."""
    raw = os.environ.get("INGEST_MAX_ROWS", "14000").strip()
    try:
        return max(0, int(raw))
    except ValueError:
        return 14000


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def configure_stdout_utf8() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        try:
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
            sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
        except Exception:
            pass


def patch_windows_signal_for_transformers() -> None:
    if hasattr(signal, "SIGALRM"):
        return
    try:
        signal.SIGALRM = signal.SIGABRT  # type: ignore[attr-defined]
    except Exception:
        return
    if not hasattr(signal, "alarm"):
        try:
            signal.alarm = lambda _seconds: 0  # type: ignore[attr-defined]
        except Exception:
            pass


def compute_sha256_file(
    path: str,
    chunk_size: int = 1024 * 1024,
    progress_every_mb: float = 64.0,
) -> str:
    """Full-file SHA-256 for idempotency; large Parquets can take minutes — log progress."""
    h = hashlib.sha256()
    total = 0
    step = int(progress_every_mb * 1024 * 1024)
    next_report = step
    with open(path, "rb") as f:
        while True:
            b = f.read(chunk_size)
            if not b:
                break
            h.update(b)
            total += len(b)
            if total >= next_report:
                print(f"  ... checksum: {total / (1024 * 1024):.0f} MB read", flush=True)
                next_report += step
    return h.hexdigest()


# ---------------------------------------------------------------------------
# Supabase REST client (same pattern as ingest-umls-qa-jsonl-cuda.py)
# ---------------------------------------------------------------------------

class SupabaseRestClient:
    def __init__(self, supabase_url: str, supabase_key: str, timeout_s: int = 120):
        self.base = supabase_url.rstrip("/")
        self.key = supabase_key
        self.timeout_s = timeout_s
        self.session = requests.Session()
        self.headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        }

    def _request_with_retries(self, method: str, url: str, *, params: Dict[str, Any], headers: Dict[str, str], data: str) -> requests.Response:
        max_retries = int(os.environ.get("SUPABASE_RETRIES", "6"))
        base_sleep = float(os.environ.get("SUPABASE_RETRY_BASE_S", "1.0"))
        timeout_s = int(os.environ.get("SUPABASE_TIMEOUT_S", str(self.timeout_s)))

        last_exc: Optional[BaseException] = None
        for attempt in range(max_retries + 1):
            try:
                return self.session.request(method, url, params=params, headers=headers, data=data, timeout=timeout_s)
            except (requests.exceptions.ReadTimeout, requests.exceptions.ConnectionError) as exc:
                last_exc = exc
                if attempt >= max_retries:
                    raise
                time.sleep(base_sleep * (2 ** attempt))
        raise last_exc  # type: ignore[misc]

    def upsert(self, table: str, records: List[Dict[str, Any]], on_conflict: str) -> Tuple[int, List[str]]:
        if not records:
            return 0, []
        url = f"{self.base}/rest/v1/{table}"
        params = {"on_conflict": on_conflict}
        headers = dict(self.headers)
        headers["Prefer"] = "resolution=merge-duplicates"
        try:
            resp = self._request_with_retries("POST", url, params=params, headers=headers, data=json.dumps(records))
        except Exception as exc:
            return 0, [f"HTTP request failed: {type(exc).__name__}: {exc}"]
        if resp.status_code >= 300:
            return 0, [f"HTTP {resp.status_code}: {resp.text}"]
        return len(records), []

    def upsert_ingestion_file_state(self, path: str, mtime_ms: int, size: int, content_hash: str) -> None:
        self.upsert(
            "ingestion_file_state",
            [{"path": path, "mtime_ms": mtime_ms, "size": size, "content_hash": content_hash, "updated_at": utc_now_iso()}],
            on_conflict="path",
        )

    def get_file_state(self, path: str) -> Optional[Dict[str, Any]]:
        url = f"{self.base}/rest/v1/ingestion_file_state"
        params = {"select": "path,mtime_ms,size,content_hash", "path": f"eq.{path}"}
        resp = requests.get(url, params=params, headers=self.headers, timeout=self.timeout_s)
        if resp.status_code >= 300:
            return None
        data = resp.json()
        return data[0] if data else None


# ---------------------------------------------------------------------------
# Zilliz / Milvus vector client (replaces knowledge_base upserts)
# ---------------------------------------------------------------------------


def normalize_zilliz_https_endpoint(endpoint: str) -> str:
    """Fix Zilliz Cloud SaaS URIs: pymilvus defaults https://host (no port) to :19530; Serverless uses :443.

    Also handles .env values that are a bare hostname (no scheme) — urlparse would not see https and
    normalization would be skipped, leaving pymilvus on 19530.
    """
    raw = (endpoint or "").strip().strip('"').strip("'")
    if not raw:
        return raw
    if "://" not in raw:
        raw = "https://" + raw.lstrip("/")
    p = urlparse(raw)
    if not p.hostname:
        return raw
    try:
        saas_port = int(os.environ.get("ZILLIZ_HTTPS_PORT", "443"))
    except ValueError:
        saas_port = 443

    host_l = p.hostname.lower()
    scheme = (p.scheme or "https").lower()
    if scheme not in ("http", "https"):
        return raw

    # Zilliz Serverless / public HTTPS gateway (not self-hosted Milvus on 19530)
    is_zilliz_serverless = "serverless" in host_l or host_l.endswith(".cloud.zilliz.com")
    port = p.port

    if scheme == "http" and is_zilliz_serverless:
        scheme = "https"

    if scheme == "https" and is_zilliz_serverless:
        if port is None or port == 19530:
            port = saas_port

    netloc = f"{p.hostname}:{port}" if port is not None else p.hostname
    return urlunparse((scheme, netloc, p.path, p.params, p.query, p.fragment))


class ZillizVectorClient:
    """Thin wrapper around pymilvus MilvusClient for batch upsert."""

    COLLECTION = os.environ.get("ZILLIZ_COLLECTION", "knowledge_base")

    def __init__(self, endpoint: str, token: str):
        if _PyMilvusClient is None:
            raise ImportError(
                "pymilvus is required for Zilliz ingest. Run: pip install -r scripts/requirements.txt"
            )
        uri = normalize_zilliz_https_endpoint(endpoint)
        if uri.rstrip("/") != (endpoint or "").strip().strip('"').strip("'").rstrip("/"):
            print(
                "  Zilliz URI adjusted (scheme/port for pymilvus + Zilliz Serverless on 443).",
                flush=True,
            )
            print(f"  Effective → {urlparse(uri).hostname}:{urlparse(uri).port} ({urlparse(uri).scheme})", flush=True)
        try:
            connect_timeout = float(os.environ.get("ZILLIZ_CONNECT_TIMEOUT", "45"))
        except ValueError:
            connect_timeout = 45.0
        self.client = _PyMilvusClient(uri=uri, token=token, timeout=connect_timeout)

    def upsert_batch(self, rows: List[Dict[str, Any]]) -> Tuple[int, List[str]]:
        """Upsert rows into the Zilliz collection. Returns (count, errors)."""
        if not rows:
            return 0, []
        try:
            res = self.client.upsert(collection_name=self.COLLECTION, data=rows)
            count = res.get("upsert_count", len(rows)) if isinstance(res, dict) else len(rows)
            return count, []
        except Exception as exc:
            return 0, [f"Zilliz upsert: {type(exc).__name__}: {exc}"]


# ---------------------------------------------------------------------------
# Embedder (same as CUDA ingest)
# ---------------------------------------------------------------------------

class Embedder:
    def __init__(self, model_name: str, device: str, dim: int):
        self.model_name = model_name
        self.device = device
        self.dim = dim

        patch_windows_signal_for_transformers()
        import torch
        from transformers import AutoModel, AutoTokenizer

        self._torch = torch
        trust_remote = bool(os.environ.get("HF_TRUST_REMOTE_CODE", "").strip() == "1") or model_name.startswith("nomic-ai/")
        self._tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=trust_remote)
        self._model = AutoModel.from_pretrained(model_name, trust_remote_code=trust_remote)
        self._model.eval()
        self._model.to("cuda" if device == "cuda" else "cpu")

    def embed_texts(self, texts: List[str], batch_size: int) -> List[List[float]]:
        import torch

        embeddings: List[List[float]] = []
        max_length = int(os.environ.get("EMBED_MAX_LENGTH", "512"))

        with torch.inference_mode():
            use_amp = self.device == "cuda"
            for start in range(0, len(texts), batch_size):
                batch = texts[start: start + batch_size]
                tok = self._tokenizer(batch, padding=True, truncation=True, max_length=max_length, return_tensors="pt")
                if self.device == "cuda":
                    tok = {k: v.to("cuda") for k, v in tok.items()}

                if use_amp:
                    with torch.autocast(device_type="cuda", dtype=torch.float16):
                        out = self._model(**tok)
                else:
                    out = self._model(**tok)

                last_hidden = out.last_hidden_state
                mask = tok["attention_mask"].unsqueeze(-1).type_as(last_hidden)
                mean_pooled = (last_hidden * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1e-9)
                norm = mean_pooled.norm(p=2, dim=1, keepdim=True).clamp(min=1e-12)
                normalized = mean_pooled / norm
                vecs = normalized.detach().cpu().tolist()

                if self.dim and vecs and len(vecs[0]) != self.dim:
                    raise RuntimeError(f"Embedding dim mismatch: expected {self.dim}, got {len(vecs[0])}")
                embeddings.extend(vecs)

        return embeddings


def resolve_ingest_embed_provider() -> str:
    """openrouter | hf — HF uses local torch/transformers (Nomic)."""
    explicit = os.environ.get("INGEST_EMBED_PROVIDER", "").strip().lower()
    if explicit == "openrouter":
        return "openrouter"
    if explicit in ("hf", "torch", "hf_torch", "transformers"):
        return "hf"
    main = os.environ.get("EMBEDDING_PROVIDER", "").strip().lower()
    if main == "openrouter":
        return "openrouter"
    return "hf"


def default_embed_dim() -> int:
    for key in ("EMBEDDING_DIM", "EMBED_DIM"):
        raw = os.environ.get(key, "").strip()
        if not raw:
            continue
        try:
            n = int(raw)
            if n > 0:
                return n
        except ValueError:
            continue
    return EMBEDDING_DIM_DEFAULT


class OpenRouterEmbedder:
    """Embeddings via OpenRouter HTTP API (aligned with Node @openrouter/sdk)."""

    def __init__(self, model_name: str, dim: int):
        self.model_name = model_name
        self.dim = dim
        self.api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
        if not self.api_key:
            raise RuntimeError("OPENROUTER_API_KEY is required for OpenRouter ingest")
        base = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")
        self.embeddings_url = f"{base}/embeddings"
        self.timeout_s = int(os.environ.get("OPENROUTER_TIMEOUT_S", "120"))
        self.max_retries = int(os.environ.get("OPENROUTER_RETRIES", "4"))

    def embed_texts(self, texts: List[str], batch_size: int) -> List[List[float]]:
        session = requests.Session()
        headers: Dict[str, str] = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        ref = os.environ.get("OPENROUTER_HTTP_REFERER", "").strip()
        if ref:
            headers["HTTP-Referer"] = ref
        title = os.environ.get("OPENROUTER_APP_TITLE", "").strip()
        if title:
            headers["X-OpenRouter-Title"] = title

        out: List[List[float]] = []
        for start in range(0, len(texts), batch_size):
            batch = texts[start : start + batch_size]
            last_err: Optional[BaseException] = None
            for attempt in range(self.max_retries + 1):
                try:
                    resp = session.post(
                        self.embeddings_url,
                        headers=headers,
                        json={
                            "model": self.model_name,
                            "input": batch,
                            "encoding_format": "float",
                        },
                        timeout=self.timeout_s,
                    )
                    if resp.status_code >= 300:
                        raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:800]}")
                    body = resp.json()
                    data = body.get("data") or []
                    data.sort(key=lambda x: int(x.get("index", 0)))
                    if len(data) != len(batch):
                        raise RuntimeError(
                            f"OpenRouter returned {len(data)} embeddings for batch size {len(batch)}"
                        )
                    for row in data:
                        emb = row.get("embedding")
                        if not isinstance(emb, list):
                            raise RuntimeError("OpenRouter: missing or invalid embedding vector")
                        if len(emb) != self.dim:
                            raise RuntimeError(
                                f"Embedding dim mismatch: expected {self.dim}, got {len(emb)} — set EMBEDDING_DIM to match the model"
                            )
                        out.append([float(x) for x in emb])
                    last_err = None
                    break
                except (requests.exceptions.RequestException, RuntimeError, ValueError, KeyError) as exc:
                    last_err = exc
                    if attempt >= self.max_retries:
                        break
                    time.sleep(min(8.0, 0.5 * (2**attempt)))
            if last_err is not None:
                raise last_err
        return out


def resolve_device(device_arg: Optional[str]) -> str:
    import torch
    if device_arg is None or device_arg == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    if device_arg.lower() in ("cuda", "gpu"):
        if not torch.cuda.is_available():
            print("Warning: cuda not available, falling back to cpu", file=sys.stderr)
            return "cpu"
        return "cuda"
    return "cpu"


# ---------------------------------------------------------------------------
# Checkpoint helpers
# ---------------------------------------------------------------------------

def read_checkpoint(path_key: str) -> Optional[Dict[str, Any]]:
    if not os.path.exists(CHECKPOINT_FILE):
        return None
    try:
        with open(CHECKPOINT_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get(path_key)
    except Exception:
        return None


def write_checkpoint(path_key: str, state: Dict[str, Any]) -> None:
    os.makedirs(CHECKPOINT_DIR, exist_ok=True)
    existing: Dict[str, Any] = {}
    if os.path.exists(CHECKPOINT_FILE):
        try:
            with open(CHECKPOINT_FILE, "r", encoding="utf-8") as f:
                existing = json.load(f)
        except Exception:
            pass
    existing[path_key] = state
    with open(CHECKPOINT_FILE, "w", encoding="utf-8") as f:
        json.dump(existing, f, ensure_ascii=False, indent=2)


def clear_checkpoint(path_key: str) -> None:
    if not os.path.exists(CHECKPOINT_FILE):
        return
    try:
        with open(CHECKPOINT_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if path_key in data:
            del data[path_key]
            with open(CHECKPOINT_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    configure_stdout_utf8()

    parser = argparse.ArgumentParser(description="Ingest UMLS META Parquet into Supabase")
    parser.add_argument("--parquet", default=os.environ.get("UMLS_META_PARQUET", DEFAULT_PARQUET))
    parser.add_argument("--zilliz-endpoint", default=os.environ.get("ZILLIZ_ENDPOINT"))
    parser.add_argument("--zilliz-token", default=os.environ.get("ZILLIZ_TOKEN"))
    parser.add_argument("--supabase-url", default=os.environ.get("SUPABASE_URL"))
    parser.add_argument("--supabase-key", default=os.environ.get("SUPABASE_KEY"))
    parser.add_argument("--device", default=os.environ.get("NOMIC_DEVICE", "auto"))
    parser.add_argument("--model", default=os.environ.get("NOMIC_HF_MODEL", "nomic-ai/nomic-embed-text-v1.5"))
    parser.add_argument("--embed-batch-size", type=int, default=int(os.environ.get("EMBED_BATCH_SIZE", "32")))
    parser.add_argument("--upsert-batch-size", type=int, default=int(os.environ.get("INGEST_BATCH_SIZE", "100")))
    parser.add_argument(
        "--embed-dim",
        type=int,
        default=None,
        help="Vector dimension (default: EMBEDDING_DIM, then EMBED_DIM env, else 768). Must match Zilliz collection.",
    )
    parser.add_argument("--checkpoint-every", type=int, default=int(os.environ.get("INGEST_CHECKPOINT_EVERY", "500")))
    parser.add_argument("--resume", action="store_true", default=os.environ.get("INGEST_RESUME_ENABLED", "1") != "0")
    parser.add_argument(
        "--max-rows",
        type=int,
        default=_default_ingest_max_rows(),
        help="Max Parquet rows (0 = all). Default from INGEST_MAX_ROWS or 14000 for ~500MB DB budgets.",
    )
    args = parser.parse_args()

    embed_dim = args.embed_dim if args.embed_dim is not None else default_embed_dim()
    ingest_provider = resolve_ingest_embed_provider()
    or_model = os.environ.get("OPENROUTER_EMBED_MODEL", "nvidia/llama-nemotron-embed-vl-1b-v2:free").strip()

    parquet_path = os.path.abspath(args.parquet)
    if not os.path.isfile(parquet_path):
        print(f"ERROR: Parquet file not found: {parquet_path}", file=sys.stderr)
        sys.exit(1)
    if not args.zilliz_endpoint or not args.zilliz_token:
        print("ERROR: ZILLIZ_ENDPOINT and ZILLIZ_TOKEN required", file=sys.stderr)
        sys.exit(1)

    path_key = f"umls_meta/{os.path.basename(parquet_path)}"

    print("\n=== UMLS META Parquet Ingest (startup) ===", flush=True)
    print(f"  Parquet : {parquet_path}", flush=True)
    stat = os.stat(parquet_path)
    print(f"  Size    : {stat.st_size / 1024 / 1024:.1f} MB", flush=True)
    print(f"  Provider: {ingest_provider} | embed_dim={embed_dim}", flush=True)

    if ingest_provider == "hf":
        print("  Loading PyTorch (lần đầu trên Windows có thể 30–90s, không phải treo)...", flush=True)
    device = resolve_device(args.device) if ingest_provider == "hf" else "cpu"
    if ingest_provider == "hf":
        print(f"  Device  : {device}", flush=True)

    _doc_prefix_env = os.environ.get("NOMIC_DOCUMENT_PREFIX", None)
    doc_prefix = "" if _doc_prefix_env == "" else (_doc_prefix_env if _doc_prefix_env is not None else "search_document: ")

    print("  Connecting Zilliz (Milvus client — có thể vài giây đến vài chục giây)...", flush=True)
    zilliz = ZillizVectorClient(args.zilliz_endpoint, args.zilliz_token)
    print("  Zilliz client OK.", flush=True)
    supa = (SupabaseRestClient(args.supabase_url, args.supabase_key)
            if args.supabase_url and args.supabase_key else None)

    print("  Computing SHA-256 của file (file lớn = vài phút; dùng cho idempotency)...", flush=True)
    sha256 = compute_sha256_file(parquet_path)

    print(f"\n=== UMLS META Parquet Ingest ===")
    print(f"  File       : {parquet_path}")
    print(f"  Size       : {stat.st_size / 1024 / 1024:.1f} MB")
    print(f"  SHA-256    : {sha256[:16]}...")
    print(f"  Embed prov. : {ingest_provider}")
    print(f"  Device     : {device if ingest_provider == 'hf' else '(OpenRouter HTTP)'}")
    print(f"  Model      : {or_model if ingest_provider == 'openrouter' else args.model}")
    print(f"  Embed dim  : {embed_dim}")
    print(f"  Embed batch: {args.embed_batch_size}")
    print(f"  Upsert batch: {args.upsert_batch_size}")
    if args.max_rows > 0:
        print(f"  Max rows   : {args.max_rows}")
    else:
        print(f"  Max rows   : (unlimited)")
    print()

    # --- Idempotency (via Supabase ingestion_file_state if available) ---
    if supa:
        file_state = supa.get_file_state(path_key)
        if file_state and file_state.get("content_hash") == sha256:
            print(f"  Skipping — checksum matches previous ingest ({sha256[:12]}...)")
            return

    # --- Resume ---
    resume_from = 0
    if args.resume:
        cp = read_checkpoint(path_key)
        if cp and cp.get("content_hash") == sha256 and isinstance(cp.get("last_row_completed"), int):
            resume_from = cp["last_row_completed"] + 1
            if resume_from > 0:
                print(f"  Resume from row {resume_from}")

    # --- Load Parquet ---
    print("  Reading Parquet into memory...", flush=True)
    table = pq.read_table(parquet_path)
    total_rows = table.num_rows
    print(f"  Parquet rows: {total_rows:,}", flush=True)

    # Absolute row cap from start of file (resume continues toward this end, not another +max_rows window)
    if args.max_rows > 0:
        effective_end = min(total_rows, args.max_rows)
    else:
        effective_end = total_rows

    # --- Init embedder ---
    if ingest_provider == "openrouter":
        print("  Initializing OpenRouter embedder...", flush=True)
        embedder = OpenRouterEmbedder(or_model, embed_dim)
        print(f"  OpenRouter ready: {or_model}", flush=True)
    else:
        print("  Loading HF tokenizer + model (có thể tải weights lần đầu — chờ)...", flush=True)
        embedder = Embedder(model_name=args.model, device=device, dim=embed_dim)
        print(f"  Model ready: {args.model}", flush=True)

    # --- Ingest loop ---
    t0 = time.time()
    upserted = 0
    errors_count = 0
    embed_batch_size = args.embed_batch_size
    upsert_batch_size = args.upsert_batch_size
    min_upsert_batch = int(os.environ.get("INGEST_MIN_BATCH_SIZE", "50"))
    first_embed_logged = False

    ingest_keys_col = table.column("ingest_key")
    contents_col = table.column("content")
    source_types_col = table.column("source_type")
    metadata_jsons_col = table.column("metadata_json")

    row_idx = resume_from
    while row_idx < effective_end:
        batch_end = min(row_idx + embed_batch_size, effective_end)
        batch_texts: List[str] = []
        batch_rows: List[Dict[str, Any]] = []

        for i in range(row_idx, batch_end):
            content = contents_col[i].as_py()
            ingest_key = ingest_keys_col[i].as_py()
            source_type = source_types_col[i].as_py()
            meta_json_str = metadata_jsons_col[i].as_py()

            meta = json.loads(meta_json_str) if meta_json_str else {}
            if ingest_provider == "openrouter":
                meta["embedding_model"] = or_model
                meta["embedding_backend"] = "openrouter/http"
            else:
                meta["embedding_model"] = args.model
                meta["embedding_backend"] = f"python/torch ({device})"
            meta["embedding_contract_version"] = EMBEDDING_CONTRACT_VERSION
            meta["embedding_dim"] = embed_dim

            prefixed = f"{doc_prefix}{content}" if doc_prefix else content
            umls_str_lower = meta.get("str", "").lower() if source_type == "umls" else ""

            batch_texts.append(prefixed)
            batch_rows.append({
                "ingest_key": ingest_key,
                "content": content,
                "source_type": source_type,
                "metadata_json": json.dumps(meta, ensure_ascii=False),
                "umls_str_lower": umls_str_lower,
                "is_active": True,
            })

        # Embed
        t_embed = time.time()
        vectors = embedder.embed_texts(batch_texts, batch_size=embed_batch_size)
        if not first_embed_logged:
            print(f"  First embed latency: {int((time.time() - t_embed) * 1000)}ms")
            first_embed_logged = True

        for j, vec in enumerate(vectors):
            batch_rows[j]["embedding"] = vec

        # Upsert in sub-batches to Zilliz
        for ub_start in range(0, len(batch_rows), upsert_batch_size):
            ub = batch_rows[ub_start: ub_start + upsert_batch_size]
            inserted, errs = zilliz.upsert_batch(ub)
            if errs:
                errors_count += len(errs)
                joined = " | ".join(errs).lower()
                if ("timeout" in joined or "read timed out" in joined) and upsert_batch_size > min_upsert_batch:
                    upsert_batch_size = max(min_upsert_batch, upsert_batch_size // 2)
                    print(f"\n  Upsert timeout; reducing batch to {upsert_batch_size}")
                for e in errs:
                    print(f"  ERROR: {e}", file=sys.stderr)
            else:
                upserted += inserted

        row_idx = batch_end

        # Checkpoint
        if row_idx % args.checkpoint_every < embed_batch_size and args.resume:
            write_checkpoint(path_key, {
                "content_hash": sha256,
                "last_row_completed": row_idx - 1,
                "upserted": upserted,
                "errors_count": errors_count,
                "updated_at": utc_now_iso(),
            })

        # Progress
        elapsed = max(time.time() - t0, 1e-3)
        rps = row_idx / elapsed
        sys.stdout.write(f"\r  row {row_idx:,}/{effective_end:,} | upserted {upserted:,} | {rps:.1f} rows/s | errors {errors_count}")
        sys.stdout.flush()

    # --- Final flush & state ---
    elapsed_total = time.time() - t0
    ended_early = bool(args.max_rows > 0 and effective_end < total_rows)

    if not ended_early:
        if supa:
            supa.upsert_ingestion_file_state(
                path=path_key,
                mtime_ms=int(stat.st_mtime_ns // 1_000_000),
                size=int(stat.st_size),
                content_hash=sha256,
            )
        clear_checkpoint(path_key)
        label = "Done"
    else:
        write_checkpoint(path_key, {
            "content_hash": sha256,
            "last_row_completed": row_idx - 1,
            "upserted": upserted,
            "errors_count": errors_count,
            "partial_run": True,
            "updated_at": utc_now_iso(),
        })
        label = "Partial run"

    print(f"\n\n  {label} in {elapsed_total:.1f}s — {row_idx:,} rows processed | {upserted:,} upserted | {errors_count} errors")

    if errors_count:
        print(f"\n  WARNING: {errors_count} upsert errors occurred", file=sys.stderr)


if __name__ == "__main__":
    main()
