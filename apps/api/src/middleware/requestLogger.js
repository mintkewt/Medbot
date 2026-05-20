const { randomUUID } = require("crypto");
const logger = require("../utils/logger");

function sanitizeBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const clone = { ...body };
  const redactKeys = [
    "password",
    "token",
    "apiKey",
    "api_key",
    "authorization",
    "Authorization",
    "secret",
    "SUPABASE_KEY",
  ];
  for (const k of redactKeys) {
    if (clone[k] !== undefined) clone[k] = "[REDACTED]";
  }
  if (typeof clone.question === "string" && clone.question.length > 400) {
    clone.question = `${clone.question.slice(0, 400)}…`;
  }
  return clone;
}

/**
 * Attach requestId, log incoming request, and log when the response finishes (duration + status).
 */
function requestContext(req, res, next) {
  req.requestId = randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  req._startedAt = Date.now();

  logger.debug("http.request", {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl || req.url,
    query: req.query && Object.keys(req.query).length ? req.query : undefined,
    ip: req.ip,
    userAgent: req.get("user-agent"),
    contentLength: req.get("content-length"),
  });

  let logged = false;
  const logComplete = () => {
    if (logged) return;
    logged = true;
    const durationMs = Date.now() - req._startedAt;
    logger.http("http.complete", {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs,
    });
  };

  res.on("finish", logComplete);
  res.on("close", () => {
    if (!res.writableEnded) logComplete();
  });

  next();
}

/** Runs after express.json — logs sanitized body (debug). */
function logRequestBody(req, _res, next) {
  if (req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) {
    logger.debug("http.body", {
      requestId: req.requestId,
      body: sanitizeBody(req.body),
    });
  }
  next();
}

module.exports = { requestContext, logRequestBody, sanitizeBody };
