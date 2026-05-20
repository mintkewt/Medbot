#!/usr/bin/env python3
"""
Export UMLS Metathesaurus (MRCONSO + MRDEF + MRSTY) into a Parquet file
optimised for the knowledge_base RAG ingest pipeline.

Only English concepts **with at least one definition** are exported.
Each output row matches the ingest contract:
  ingest_key  – deterministic, e.g. "umls:meta:C0000039" or "umls:meta:C0000039:chunk:1"
  content     – human-readable text block (term + definition + synonyms + semantic types)
  source_type – "umls"
  metadata_json – JSON string with structured fields for reranking / filtering

Usage:
  python scripts/export-umls-meta-parquet.py                               # defaults
  python scripts/export-umls-meta-parquet.py --meta-dir data/umls-2025AB-metathesaurus-full/2025AB/META
  python scripts/export-umls-meta-parquet.py --chunk-size 1200 --max-synonyms 15

Env overrides:
  UMLS_META_DIR        – path to META folder
  EXPORT_MAX_CUIS      – max CUIs in Parquet (0 = all; trims after MRDEF filter)
  EXPORT_CHUNK_SIZE    – max chars per content chunk  (default 1500)
  EXPORT_CHUNK_OVERLAP – overlap chars between chunks (default 200)
  EXPORT_MAX_SYNONYMS  – synonym cap per CUI         (default 20)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

import pyarrow as pa
import pyarrow.parquet as pq

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_META_DIR = os.path.normpath(
    os.path.join(SCRIPT_DIR, "..", "..", "..", "data", "umls-2025AB-metathesaurus-full", "2025AB", "META")
)

EXPORT_FORMAT_VERSION = "2"
CHUNK_SIZE_DEFAULT = 1500
CHUNK_OVERLAP_DEFAULT = 200
MAX_SYNONYMS_DEFAULT = 20

ENGLISH_DEF_SABS = {
    "MSH", "NCI", "HPO", "CHV", "MEDLINEPLUS", "CSP", "GO", "UWDA", "FMA",
    "HL7V3.0", "ICF", "LNC", "RXNORM", "SNOMEDCT_US", "MTH", "NCI_NCI-GLOSS",
    "NCI_CDISC", "NCI_FDA", "AOD", "PDQ", "OMIM",
}

NON_ENG_SAB_SUFFIX = re.compile(
    r"(ARA|BAQ|CHI|CZE|DAN|DUT|EST|FIN|FRE|GER|GRE|HEB|HUN|ISL|ITA|JPN|"
    r"KOR|LAV|NOR|POL|POR|RUS|SCR|SPA|SWE|THA|TUR|UKR|VIE)$"
)


def _max_cuis_from_env() -> int:
    raw = os.environ.get("EXPORT_MAX_CUIS", "0").strip()
    try:
        return max(0, int(raw))
    except ValueError:
        return 0


def is_english_sab(sab: str) -> bool:
    if sab in ENGLISH_DEF_SABS:
        return True
    if NON_ENG_SAB_SUFFIX.search(sab):
        return False
    return True


def split_text_chunks(text: str, chunk_size: int, chunk_overlap: int) -> List[str]:
    if len(text) <= chunk_size:
        return [text]

    separators = ["\n\n", "\n", ". ", "! ", "? ", ", ", " "]
    chunks: List[str] = []
    start = 0
    n = len(text)

    while start < n:
        end = min(n, start + chunk_size)
        if end == n:
            chunk = text[start:end].strip()
            if chunk:
                chunks.append(chunk)
            break

        best_idx = -1
        window = text[start:end]
        for sep in separators:
            idx = window.rfind(sep)
            if idx > best_idx:
                best_idx = idx

        if best_idx > 0:
            end = start + best_idx + 1

        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)

        next_start = end - chunk_overlap
        if next_start <= start:
            next_start = end
        start = next_start

    return chunks


def load_mrsty(meta_dir: str) -> Dict[str, List[str]]:
    """CUI -> list of semantic type strings."""
    path = os.path.join(meta_dir, "MRSTY.RRF")
    cui_sty: Dict[str, List[str]] = defaultdict(list)
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("|")
            if len(parts) < 4:
                continue
            cui, sty = parts[0], parts[3]
            if sty and sty not in cui_sty[cui]:
                cui_sty[cui].append(sty)
    print(f"  MRSTY: {len(cui_sty):,} CUIs with semantic types")
    return dict(cui_sty)


def load_mrdef_english(meta_dir: str) -> Dict[str, str]:
    """CUI -> first English definition (prefer MSH > NCI > others)."""
    path = os.path.join(meta_dir, "MRDEF.RRF")

    SAB_PRIORITY = {"MSH": 0, "NCI": 1, "NCI_NCI-GLOSS": 2, "SNOMEDCT_US": 3, "HPO": 4}

    cui_def: Dict[str, Tuple[int, str]] = {}
    total = 0
    kept = 0

    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            total += 1
            parts = line.rstrip("\n").split("|")
            if len(parts) < 7:
                continue
            cui, sab, definition, suppress = parts[0], parts[4], parts[5], parts[6]
            if suppress == "Y":
                continue
            if not is_english_sab(sab):
                continue
            if not definition or not definition.strip():
                continue

            prio = SAB_PRIORITY.get(sab, 99)
            if cui not in cui_def or prio < cui_def[cui][0]:
                cui_def[cui] = (prio, definition.strip())
                kept += 1

    result = {cui: defn for cui, (_, defn) in cui_def.items()}
    print(f"  MRDEF: {total:,} total rows -> {len(result):,} CUIs with English definitions")
    return result


def stream_mrconso_english(
    meta_dir: str,
    cui_filter: set,
    max_synonyms: int,
) -> Dict[str, Dict[str, Any]]:
    """
    Stream MRCONSO.RRF, collect English preferred term + synonyms for CUIs in cui_filter.
    Returns dict: CUI -> { preferred_term, synonyms: list[str] }
    """
    path = os.path.join(meta_dir, "MRCONSO.RRF")

    cui_info: Dict[str, Dict[str, Any]] = {}
    lines_read = 0
    eng_kept = 0

    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            lines_read += 1
            if lines_read % 2_000_000 == 0:
                sys.stdout.write(f"\r  MRCONSO: {lines_read:,} lines scanned, {eng_kept:,} ENG atoms kept ...")
                sys.stdout.flush()

            parts = line.rstrip("\n").split("|")
            if len(parts) < 17:
                continue

            cui, lat, ts, ispref, sab, tty, strn, suppress = (
                parts[0], parts[1], parts[2], parts[6], parts[11], parts[12], parts[14], parts[16],
            )

            if lat != "ENG" or suppress == "Y":
                continue
            if cui not in cui_filter:
                continue

            eng_kept += 1
            strn_clean = strn.strip()
            if not strn_clean:
                continue

            if cui not in cui_info:
                cui_info[cui] = {"preferred_term": None, "synonyms": set()}

            entry = cui_info[cui]

            is_pref = ts == "P" and ispref == "Y"
            if is_pref and entry["preferred_term"] is None:
                entry["preferred_term"] = strn_clean

            if len(entry["synonyms"]) < max_synonyms:
                entry["synonyms"].add(strn_clean)

    sys.stdout.write(f"\r  MRCONSO: {lines_read:,} lines scanned, {eng_kept:,} ENG atoms kept\n")
    sys.stdout.flush()

    for cui, entry in cui_info.items():
        if entry["preferred_term"] is None and entry["synonyms"]:
            entry["preferred_term"] = next(iter(entry["synonyms"]))
        entry["synonyms"] = sorted(entry["synonyms"])

    print(f"  MRCONSO: {len(cui_info):,} CUIs with English terms")
    return cui_info


def build_content(
    preferred_term: str,
    definition: str,
    synonyms: List[str],
    semantic_types: List[str],
) -> str:
    parts = [preferred_term]
    parts.append(f"\nDefinition: {definition}")

    other_syns = [s for s in synonyms if s != preferred_term]
    if other_syns:
        parts.append(f"\nSynonyms: {', '.join(other_syns)}")

    if semantic_types:
        parts.append(f"\nSemantic Types: {', '.join(semantic_types)}")

    return "\n".join(parts)


def main() -> None:
    parser = argparse.ArgumentParser(description="Export UMLS META to Parquet for RAG ingest")
    parser.add_argument(
        "--meta-dir",
        default=os.environ.get("UMLS_META_DIR", DEFAULT_META_DIR),
    )
    parser.add_argument(
        "--output",
        default=os.environ.get("EXPORT_OUTPUT", None),
    )
    parser.add_argument("--chunk-size", type=int, default=int(os.environ.get("EXPORT_CHUNK_SIZE", str(CHUNK_SIZE_DEFAULT))))
    parser.add_argument("--chunk-overlap", type=int, default=int(os.environ.get("EXPORT_CHUNK_OVERLAP", str(CHUNK_OVERLAP_DEFAULT))))
    parser.add_argument("--max-synonyms", type=int, default=int(os.environ.get("EXPORT_MAX_SYNONYMS", str(MAX_SYNONYMS_DEFAULT))))
    parser.add_argument(
        "--max-cuis",
        type=int,
        default=_max_cuis_from_env(),
        help="Limit CUIs (0 = all). Default from EXPORT_MAX_CUIS env.",
    )

    args = parser.parse_args()
    meta_dir = os.path.abspath(args.meta_dir)

    if not os.path.isdir(meta_dir):
        print(f"ERROR: META dir not found: {meta_dir}", file=sys.stderr)
        sys.exit(1)

    output_path = args.output or os.path.join(
        SCRIPT_DIR, "..", "..", "..", "data",
        "umls_meta_en_def_optimized.parquet",
    )
    output_path = os.path.normpath(os.path.abspath(output_path))

    print(f"\n=== UMLS META -> Parquet Export ===")
    print(f"  META dir     : {meta_dir}")
    print(f"  Output       : {output_path}")
    print(f"  Chunk size   : {args.chunk_size}")
    print(f"  Chunk overlap: {args.chunk_overlap}")
    print(f"  Max synonyms : {args.max_synonyms}")
    if args.max_cuis:
        print(f"  Max CUIs     : {args.max_cuis}")
    print()

    t0 = time.time()

    # Step 1: semantic types
    print("Step 1/4: Loading MRSTY ...")
    cui_sty = load_mrsty(meta_dir)

    # Step 2: definitions
    print("Step 2/4: Loading MRDEF (English) ...")
    cui_def = load_mrdef_english(meta_dir)

    if args.max_cuis:
        cui_set = set(list(cui_def.keys())[:args.max_cuis])
        cui_def = {c: d for c, d in cui_def.items() if c in cui_set}
        print(f"  Limited to {len(cui_def):,} CUIs for testing")
    else:
        cui_set = set(cui_def.keys())

    # Step 3: terms from MRCONSO
    print("Step 3/4: Streaming MRCONSO (English) ...")
    cui_terms = stream_mrconso_english(meta_dir, cui_set, args.max_synonyms)

    # Step 4: build records and write Parquet
    print("Step 4/4: Building records and writing Parquet ...")

    ingest_keys: List[str] = []
    contents: List[str] = []
    source_types: List[str] = []
    metadata_jsons: List[str] = []

    total_chunks = 0
    skipped_no_term = 0

    for cui in sorted(cui_def.keys()):
        definition = cui_def[cui]
        terms = cui_terms.get(cui)
        sty_list = cui_sty.get(cui, [])

        if terms is None:
            skipped_no_term += 1
            preferred = cui
            synonyms: List[str] = []
        else:
            preferred = terms["preferred_term"] or cui
            synonyms = terms["synonyms"]

        content_text = build_content(preferred, definition, synonyms, sty_list)

        chunks = split_text_chunks(content_text, args.chunk_size, args.chunk_overlap)

        for ci, chunk in enumerate(chunks):
            if len(chunks) == 1:
                key = f"umls:meta:{cui}"
            else:
                key = f"umls:meta:{cui}:chunk:{ci}"

            meta: Dict[str, Any] = {
                "cui": cui,
                "preferred_term": preferred,
                "semantic_types": sty_list,
                "source": "UMLS-2025AB",
                "record_type": "definition",
                "language_hint": "en",
                "export_format_version": EXPORT_FORMAT_VERSION,
            }
            if len(chunks) > 1:
                meta["chunk_index"] = ci
                meta["chunk_total"] = len(chunks)
            if synonyms:
                meta["synonym_count"] = len(synonyms)

            ingest_keys.append(key)
            contents.append(chunk)
            source_types.append("umls")
            metadata_jsons.append(json.dumps(meta, ensure_ascii=False))
            total_chunks += 1

    table = pa.table({
        "ingest_key": pa.array(ingest_keys, type=pa.string()),
        "content": pa.array(contents, type=pa.string()),
        "source_type": pa.array(source_types, type=pa.string()),
        "metadata_json": pa.array(metadata_jsons, type=pa.string()),
    })

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    pq.write_table(table, output_path, compression="snappy")

    elapsed = time.time() - t0
    file_size_mb = os.path.getsize(output_path) / (1024 * 1024)

    print(f"\n=== Done in {elapsed:.1f}s ===")
    print(f"  CUIs with defs : {len(cui_def):,}")
    print(f"  Skipped no term: {skipped_no_term:,}")
    print(f"  Total rows     : {total_chunks:,}")
    print(f"  Parquet size   : {file_size_mb:.1f} MB")
    print(f"  Output         : {output_path}")


if __name__ == "__main__":
    main()
