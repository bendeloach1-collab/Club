import "server-only";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { ZodError } from "zod";
import { AppError } from "@/lib/errors";
import { reportError } from "@/lib/log";

export type ActionState = { ok?: boolean; error?: string; message?: string; fieldErrors?: Record<string, string> } | undefined;

/** Convert thrown errors into safe, user-facing form state. Unknown errors are reported, not leaked. */
export function actionError(e: unknown): ActionState {
  if (isRedirectError(e)) throw e;
  if (e instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of e.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
    return { ok: false, error: "Please check the highlighted fields.", fieldErrors };
  }
  if (e instanceof AppError) return { ok: false, error: e.message };
  reportError("action.unhandled", e);
  return { ok: false, error: "Something went wrong on our side. Please try again." };
}

export function apiError(e: unknown): Response {
  if (e instanceof ZodError) return Response.json({ error: { code: "validation_error", message: "Invalid request.", fields: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } }, { status: 422 });
  if (e instanceof AppError) return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status });
  reportError("api.unhandled", e);
  return Response.json({ error: { code: "internal_error", message: "Unexpected error." } }, { status: 500 });
}
