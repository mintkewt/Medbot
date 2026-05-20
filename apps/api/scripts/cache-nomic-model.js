#!/usr/bin/env node
/** Download/cache Nomic ONNX to disk — `pnpm nomic:cache` */
require('dotenv').config();
const path = require('path');
const { embeddingProvider } = require(path.join(__dirname, '..', 'src', 'config', 'embeddingContract'));
const nomic = require(path.join(__dirname, '..', 'src', 'utils', 'nomicEmbed'));

(async () => {
  if (embeddingProvider() === 'openrouter') {
    console.log('nomic:cache skipped — EMBEDDING_PROVIDER=openrouter (no local ONNX preload).');
    process.exit(0);
  }
  const model = nomic.resolveModelId();
  const cacheRoot = process.env.TRANSFORMERS_CACHE?.trim() || path.join(process.cwd(), '.cache', 'transformers');
  const t0 = Date.now();
  await nomic.getExtractor();
  await nomic.embedQuery('warmup');
  await nomic.embedDocument('warmup');
  console.log(`nomic:cache OK — ${model} @ ${cacheRoot} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  process.exit(0);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
