/**
 * Routes embedQuery / embedDocument to ONNX (Nomic) or OpenRouter per EMBEDDING_PROVIDER.
 */
const { embeddingProvider } = require('../config/embeddingContract');
const nomic = require('./nomicEmbed');
const openRouter = require('./openRouterEmbed');

function provider() {
  return embeddingProvider();
}

async function embedQuery(text) {
  if (provider() === 'openrouter') {
    return openRouter.embedQuery(text);
  }
  return nomic.embedQuery(text);
}

async function embedDocument(text) {
  if (provider() === 'openrouter') {
    return openRouter.embedDocument(text);
  }
  return nomic.embedDocument(text);
}

module.exports = {
  embedQuery,
  embedDocument,
  provider,
};
