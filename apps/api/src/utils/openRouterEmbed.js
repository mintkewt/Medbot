/**
 * OpenRouter embeddings API via @openrouter/sdk (text input).
 * Requires OPENROUTER_API_KEY and EMBEDDING_DIM matching the chosen model output.
 */
const { OpenRouter } = require('@openrouter/sdk');
const {
  OPENROUTER_EMBED_MODEL,
  queryPrefix,
  documentPrefix,
  validateDimension,
} = require('../config/embeddingContract');
const logger = require('./logger');

let _client = null;

function getClient() {
  if (_client) return _client;
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is required when EMBEDDING_PROVIDER=openrouter');
  }
  _client = new OpenRouter({ apiKey });
  return _client;
}

function toFloatVector(embedding) {
  if (Array.isArray(embedding)) {
    return embedding.map((x) => Number(x));
  }
  if (typeof embedding === 'string') {
    const parsed = JSON.parse(embedding);
    return Array.isArray(parsed) ? parsed.map((x) => Number(x)) : null;
  }
  return null;
}

async function embedPrefixed(text, prefixFn) {
  const p = prefixFn();
  const input = p ? `${p}${text}` : text;
  const client = getClient();
  const model = OPENROUTER_EMBED_MODEL;

  const res = await client.embeddings.generate({
    requestBody: {
      model,
      input,
      encodingFormat: 'float',
    },
  });

  const raw = res?.data?.[0]?.embedding;
  const vec = toFloatVector(raw);
  if (!vec) {
    logger.error('openrouter_embed.bad_response', { model, keys: res ? Object.keys(res) : [] });
    throw new Error('OpenRouter embeddings: missing data[0].embedding');
  }
  validateDimension(vec, 'OpenRouter embedding');
  return vec;
}

async function embedQuery(text) {
  return embedPrefixed(text, queryPrefix);
}

async function embedDocument(text) {
  return embedPrefixed(text, documentPrefix);
}

module.exports = {
  embedQuery,
  embedDocument,
  getClient,
};
