/** Domain errors. `code` is stable and safe to show to clients; messages never contain private data. */
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
export class ValidationError extends AppError {
  constructor(message: string, code = "validation_error") {
    super(code, message, 422);
  }
}
export class UnauthenticatedError extends AppError {
  constructor() {
    super("unauthenticated", "Please sign in to continue.", 401);
  }
}
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do that.") {
    super("forbidden", message, 403);
  }
}
export class NotFoundError extends AppError {
  constructor(what = "Record") {
    super("not_found", `${what} not found.`, 404);
  }
}
export class ConflictError extends AppError {
  constructor(message: string, code = "conflict") {
    super(code, message, 409);
  }
}

/** Postgres error codes we translate into domain errors. */
export const PG_UNIQUE_VIOLATION = "23505";
export const PG_EXCLUSION_VIOLATION = "23P01";
export function pgErrorCode(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}
export function pgConstraint(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const c = (cur as { constraint?: unknown }).constraint;
    if (typeof c === "string") return c;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}
