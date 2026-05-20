/**
 * Structured JSON logs for grep / log aggregation.
 * LOG_LEVEL: error | warn | info | http | debug (default: info prod, debug dev)
 */

const LEVELS = { error: 0, warn: 1, info: 2, http: 3, debug: 4 };

function resolveMinLevel() {
  const fromEnv = (process.env.LOG_LEVEL || "").toLowerCase();
  if (LEVELS[fromEnv] !== undefined) return fromEnv;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

const minLevel = resolveMinLevel();

function shouldLog(level) {
  return LEVELS[level] <= LEVELS[minLevel];
}

function line(level, msg, meta = {}) {
  const logObject = {
    ts: new Date().toISOString(),
    level,
    service: "api",
    msg,
    ...meta,
  };

  const spacing = process.env.NODE_ENV === "production" ? 0 : 2;
  return JSON.stringify(logObject, null, spacing);
}

function write(level, msg, meta) {
  if (!shouldLog(level)) return;
  const out = line(level, msg, meta);
  if (level === "error") console.error(out);
  else if (level === "warn") console.warn(out);
  else console.log(out);
}

module.exports = {
  error: (msg, meta) => write("error", msg, meta),
  warn: (msg, meta) => write("warn", msg, meta),
  info: (msg, meta) => write("info", msg, meta),
  http: (msg, meta) => write("http", msg, meta),
  debug: (msg, meta) => write("debug", msg, meta),
  shouldLog: (level) => shouldLog(level),
};