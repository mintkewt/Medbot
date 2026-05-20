/**
 * Client-side structured logs (JSON). Set NEXT_PUBLIC_LOG_LEVEL=debug for verbose output.
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LEVELS;

function minLevel(): number {
  const env = process.env.NEXT_PUBLIC_LOG_LEVEL?.toLowerCase();
  if (env && env in LEVELS) return LEVELS[env as LogLevel];
  return process.env.NODE_ENV === "development" ? LEVELS.debug : LEVELS.info;
}

function should(level: LogLevel): boolean {
  return LEVELS[level] >= minLevel();
}

function emit(level: LogLevel, msg: string, meta?: Record<string, unknown>) {
  if (!should(level)) return;
  const payload = {
    ts: new Date().toISOString(),
    service: "web",
    level,
    msg,
    ...meta,
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),
};
