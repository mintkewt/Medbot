/**
 * Centralized Express error middleware.
 * Must be registered last (after all routes).
 */
const logger = require('../utils/logger');

function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const message = err.expose ? err.message : 'Internal server error';

  logger.error('http.error', {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl || req.url,
    status,
    message: err.message,
    ...(status === 500 && err.stack ? { stack: err.stack } : {}),
  });

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV !== 'production' && { detail: err.message }),
  });
}

module.exports = errorHandler;
