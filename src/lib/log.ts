/**
 * Structured JSON logging. Only pass identifiers and non-sensitive metadata:
 * never names, emails, card data, health information or credentials.
 * `reportError` is the single hook for an error-monitoring service (e.g. Sentry) in production.
 */
type Fields = Record<string, string | number | boolean | null | undefined>;

function emit(level: "info" | "warn" | "error", event: string, fields: Fields = {}) {
  if (process.env.VITEST && level !== "error") return;
  const line = JSON.stringify({ level, event, ts: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Fields) => emit("info", event, fields),
  warn: (event: string, fields?: Fields) => emit("warn", event, fields),
  error: (event: string, fields?: Fields) => emit("error", event, fields),
};

export function reportError(event: string, err: unknown, fields: Fields = {}) {
  const e = err instanceof Error ? err : new Error(String(err));
  emit("error", event, { ...fields, errorName: e.name, errorMessage: e.message.slice(0, 300) });
}
