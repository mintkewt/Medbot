/**
 * Embedding contract — single source of truth for model, dimension, and prefixes.
 *
 * Query runtime (Node) and ingest (Python) MUST stay aligned on dim + model family.
 * Changing dim or model requires a new Zilliz collection and full re-embed.
 */

const CONTRACT_VERSION = '1';

const ONNX_MODEL_ID = process.env.NOMIC_ONNX_MODEL || 'Xenova/nomic-embed-text-v1';
const HF_MODEL_ID = process.env.NOMIC_HF_MODEL || 'nomic-ai/nomic-embed-text-v1.5';

const OPENROUTER_EMBED_MODEL =
  process.env.OPENROUTER_EMBED_MODEL || 'nvidia/llama-nemotron-embed-vl-1b-v2:free';

/** `onnx` (local Nomic ONNX) | `openrouter` */
function embeddingProvider() {
  return (process.env.EMBEDDING_PROVIDER || 'onnx').trim().toLowerCase();
}

function parseEmbeddingDim() {
  const raw = process.env.EMBEDDING_DIM?.trim();
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Vector dimension for Zilliz + validation.
 * Default 768 (Nomic). For OpenRouter Nemotron VL set EMBEDDING_DIM (e.g. 2048) to match the model output.
 */
const EMBEDDING_DIM = parseEmbeddingDim() ?? 768;

function documentPrefix() {
  if (process.env.NOMIC_DOCUMENT_PREFIX === '') return '';
  if (process.env.NOMIC_DOCUMENT_PREFIX != null) return process.env.NOMIC_DOCUMENT_PREFIX;
  return 'search_document: ';
}

function queryPrefix() {
  if (process.env.NOMIC_QUERY_PREFIX === '') return '';
  if (process.env.NOMIC_QUERY_PREFIX != null) return process.env.NOMIC_QUERY_PREFIX;
  return 'search_query: ';
}

function validateDimension(vector, label = 'embedding') {
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIM) {
    throw new Error(
      `${label}: expected ${EMBEDDING_DIM}-d vector, got ${Array.isArray(vector) ? vector.length : typeof vector}`
    );
  }
}

function metadataStamp(backend) {
  const p = backend || (embeddingProvider() === 'openrouter' ? 'openrouter' : 'onnx');
  if (p === 'openrouter') {
    return {
      embedding_model: OPENROUTER_EMBED_MODEL,
      embedding_backend: '@openrouter/sdk',
      embedding_contract_version: CONTRACT_VERSION,
      embedding_dim: EMBEDDING_DIM,
    };
  }
  if (p === 'hf' || p === 'python') {
    return {
      embedding_model: HF_MODEL_ID,
      embedding_backend: 'python/torch',
      embedding_contract_version: CONTRACT_VERSION,
      embedding_dim: EMBEDDING_DIM,
    };
  }
  return {
    embedding_model: ONNX_MODEL_ID,
    embedding_backend: '@xenova/transformers',
    embedding_contract_version: CONTRACT_VERSION,
    embedding_dim: EMBEDDING_DIM,
  };
}

module.exports = {
  CONTRACT_VERSION,
  ONNX_MODEL_ID,
  HF_MODEL_ID,
  OPENROUTER_EMBED_MODEL,
  EMBEDDING_DIM,
  embeddingProvider,
  documentPrefix,
  queryPrefix,
  validateDimension,
  metadataStamp,
};
