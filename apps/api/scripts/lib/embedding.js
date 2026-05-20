const path = require('path');
const { embedDocument } = require(path.join(__dirname, '..', '..', 'src', 'utils', 'embeddingProvider'));
const { validateDimension } = require(path.join(__dirname, '..', '..', 'src', 'config', 'embeddingContract'));

const RETRY_DELAYS = [500, 2000];

async function generateEmbedding(text) {
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const vec = await embedDocument(text);
      validateDimension(vec, 'ingest embedding');
      return vec;
    } catch (err) {
      if (attempt < RETRY_DELAYS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
      } else {
        console.error(`  ✖ embed: ${err.message}`);
        return null;
      }
    }
  }
}

module.exports = { generateEmbedding };
