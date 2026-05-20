/**
 * In-memory rate limiter (fixed clock window); suitable for dev / single instance.
 * No Redis — horizontal scaling needs sticky sessions or a shared store.
 */
const CONSTANTS = require('../config/constants');
const logger = require('../utils/logger');

/** @type {Map<string, number>} */
const buckets = new Map();

function pruneBuckets(windowKey, keyPrefix) {
  if (buckets.size < 5000) return;
  const minWindow = windowKey - 2;
  for (const k of buckets.keys()) {
    if (!k.startsWith(`${keyPrefix}:`)) continue;
    const w = Number(k.split(':')[1]);
    if (Number.isFinite(w) && w < minWindow) buckets.delete(k);
  }
}

function rateLimiter(opts = {}) {
  const windowMs = opts.windowMs || CONSTANTS.RATE_LIMIT.WINDOW_MS;
  const max = opts.max || CONSTANTS.RATE_LIMIT.MAX_REQUESTS;
  const keyPrefix = opts.keyPrefix || 'rl';

  return (req, res, next) => {
    const now = Date.now();
    const windowKey = Math.floor(now / windowMs);
    const identifierRaw = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const identifier = String(identifierRaw).split(',')[0].trim().slice(0, 128);
    const key = `${keyPrefix}:${windowKey}:${identifier}`;

    pruneBuckets(windowKey, keyPrefix);

    const current = (buckets.get(key) || 0) + 1;
    buckets.set(key, current);

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - current));

    if (current > max) {
      logger.warn('rate_limit.blocked', {
        requestId: req.requestId,
        identifier,
        current,
        max,
        windowMs,
      });
      return res.status(429).json({
        error: 'Too many requests',
        message: 'Too many requests. Please try again later.',
        retryAfterMs: windowMs,
      });
    }

    next();
  };
}

module.exports = rateLimiter;
