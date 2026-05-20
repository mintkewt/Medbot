/**
 * Nomic Embed (ONNX) via @xenova/transformers — RAG + ingest embeddings.
 *
 * Model/dim/prefixes are governed by embeddingContract — do NOT override here.
 * Env: TRANSFORMERS_CACHE (default: cwd/.cache/transformers), NOMIC_DEVICE
 */
const path = require('path');
const { pipeline, env } = require('@xenova/transformers');
const logger = require('./logger');
const {
  ONNX_MODEL_ID,
  EMBEDDING_DIM,
  documentPrefix,
  queryPrefix,
  validateDimension,
} = require('../config/embeddingContract');

let _extractor = null;
let _modelId = null;
let _extractorPromise = null;

function resolveModelId() {
  return ONNX_MODEL_ID;
}

const cacheDirEnv = process.env.TRANSFORMERS_CACHE?.trim();
const runningOnVercel = process.env.VERCEL === '1';
env.allowLocalModels = false;
env.cacheDir = cacheDirEnv || (runningOnVercel ? '/tmp/transformers-cache' : path.join(process.cwd(), '.cache', 'transformers'));

async function getExtractor() {
  const id = resolveModelId();
  if (_extractor && _modelId === id) return _extractor;
  if (_extractorPromise && _modelId === id) return _extractorPromise;
  const requestedDevice = process.env.NOMIC_DEVICE?.trim() || null;
  logger.info('nomic_embed.model_load', { model: id, quantized: true, cacheDir: env.cacheDir, requestedDevice: requestedDevice || 'auto' });
  _modelId = id;
  _extractorPromise = (async () => {
    try {
      const opts = requestedDevice
        ? { quantized: true, device: requestedDevice }
        : { quantized: true };
      _extractor = await pipeline('feature-extraction', id, opts);
      return _extractor;
    } catch (err) {
      if (!requestedDevice) throw err;
      logger.warn('nomic_embed.device_fallback', {
        requestedDevice,
        reason: err?.message || 'unknown_error',
        fallback: 'cpu/auto',
      });
      _extractor = await pipeline('feature-extraction', id, { quantized: true });
      return _extractor;
    } finally {
      _extractorPromise = null;
    }
  })();
  return _extractorPromise;
}

function tensorToVector(out) {
  const raw = out?.data != null ? out.data : out;
  const arr = raw instanceof Float32Array ? Array.from(raw) : Array.from(raw);
  validateDimension(arr, 'Nomic ONNX output');
  return arr;
}

async function embedRaw(text) {
  const extractor = await getExtractor();
  const out = await extractor(text, { pooling: 'mean', normalize: true });
  return tensorToVector(out);
}

async function embedDocument(text) {
  const p = documentPrefix();
  const input = p ? `${p}${text}` : text;
  return embedRaw(input);
}

async function embedQuery(text) {
  const p = queryPrefix();
  const input = p ? `${p}${text}` : text;
  return embedRaw(input);
}

module.exports = {
  getExtractor,
  embedDocument,
  embedQuery,
  embedRaw,
  resolveModelId,
  EXPECTED_DIM: EMBEDDING_DIM,
};
