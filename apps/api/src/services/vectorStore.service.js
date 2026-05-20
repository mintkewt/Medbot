const { DataType } = require('@zilliz/milvus2-sdk-node');
const milvus = require('../config/zilliz');
const logger = require('../utils/logger');
const { EMBEDDING_DIM } = require('../config/embeddingContract');

const COLLECTION = process.env.ZILLIZ_COLLECTION || 'knowledge_base';

const SCHEMA_FIELDS = [
  { name: 'ingest_key', data_type: DataType.VarChar, is_primary_key: true, max_length: 512 },
  { name: 'embedding', data_type: DataType.FloatVector, dim: EMBEDDING_DIM },
  { name: 'content', data_type: DataType.VarChar, max_length: 32768 },
  { name: 'source_type', data_type: DataType.VarChar, max_length: 128 },
  { name: 'is_active', data_type: DataType.Bool },
  { name: 'metadata_json', data_type: DataType.VarChar, max_length: 32768 },
  { name: 'umls_str_lower', data_type: DataType.VarChar, max_length: 1024 },
];

const INDEX_PARAMS = [
  { field_name: 'embedding', index_type: 'AUTOINDEX', metric_type: 'COSINE' },
];

let _collectionReady = false;

async function ensureCollection() {
  if (_collectionReady) return;
  try {
    const has = await milvus.hasCollection({ collection_name: COLLECTION });
    if (!has.value) {
      await milvus.createCollection({
        collection_name: COLLECTION,
        fields: SCHEMA_FIELDS,
        index_params: INDEX_PARAMS,
        enable_dynamic_field: false,
      });
      logger.info('vectorStore.collection.created', { collection: COLLECTION });
    }
    await milvus.loadCollection({ collection_name: COLLECTION });
    _collectionReady = true;
  } catch (err) {
    logger.error('vectorStore.ensureCollection.fail', { message: err.message });
    throw err;
  }
}

/**
 * ANN search returning documents shaped for rag.service compatibility:
 * { ingest_key, content, source_type, metadata, similarity }
 */
async function search(embedding, { threshold = 0, limit = 10, filterSourceType = null } = {}) {
  await ensureCollection();

  const parts = ['is_active == true'];
  if (filterSourceType) parts.push(`source_type == "${filterSourceType}"`);
  const filter = parts.join(' && ');

  const res = await milvus.search({
    collection_name: COLLECTION,
    data: [embedding],
    limit,
    output_fields: ['ingest_key', 'content', 'source_type', 'metadata_json'],
    filter,
    metric_type: 'COSINE',
  });

  const docs = (res.results || [])
    .filter(r => r.score >= threshold)
    .map(r => ({
      id: r.ingest_key,
      content: r.content,
      source_type: r.source_type,
      metadata: safeParse(r.metadata_json),
      similarity: r.score,
    }));

  return docs;
}

/**
 * Scalar lookup for UMLS abbreviation normalizer.
 * Replaces the Postgres `lookup_umls_metadata_str` RPC.
 */
async function lookupUmlsByStr(token) {
  await ensureCollection();

  const expr = `source_type == "umls" && is_active == true && umls_str_lower == "${token.toLowerCase().trim()}"`;

  const res = await milvus.query({
    collection_name: COLLECTION,
    filter: expr,
    output_fields: ['content', 'metadata_json'],
    limit: 1,
  });

  if (!res.data || res.data.length === 0) return null;
  const row = res.data[0];
  return { content: row.content, metadata: safeParse(row.metadata_json) };
}

function safeParse(jsonStr) {
  if (!jsonStr) return {};
  try { return JSON.parse(jsonStr); } catch { return {}; }
}

module.exports = { ensureCollection, search, lookupUmlsByStr, COLLECTION, SCHEMA_FIELDS, INDEX_PARAMS };
