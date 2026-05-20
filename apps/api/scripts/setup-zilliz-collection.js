#!/usr/bin/env node
/**
 * Create (or verify) the Zilliz Cloud collection used by RAG search.
 * Safe to run repeatedly — skips if the collection already exists.
 *
 * Usage:  node scripts/setup-zilliz-collection.js
 *   or:   pnpm zilliz:setup   (from apps/api)
 */
require('dotenv').config();
const { ensureCollection, COLLECTION } = require('../src/services/vectorStore.service');

(async () => {
  try {
    await ensureCollection();
    console.log(`Collection "${COLLECTION}" is ready on Zilliz Cloud.`);
    process.exit(0);
  } catch (err) {
    console.error('Failed to ensure collection:', err.message);
    process.exit(1);
  }
})();
