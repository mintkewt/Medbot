module.exports = {
  RAG: {
    // Zilliz COSINE similarity is in [0, 1]; tune cutoffs for your corpus.
    MIN_RELEVANCE_SCORE: 0.35,
    HIGH_RELEVANCE_SCORE: 0.50,
    MATCH_COUNT: 5
  },
  CHAT: {
    HISTORY_LIMIT: 5,
    MAX_QUESTION_CHARS: 1800,
    MAX_HISTORY_CHARS_PER_MESSAGE: 600,
    PROVIDER_TIMEOUT_MS: 60000,
    DEFAULT_SESSION_TITLE: 'New conversation',
  },
  RATE_LIMIT: {
    WINDOW_MS: 60_000,
    MAX_REQUESTS: 20
  }
};
