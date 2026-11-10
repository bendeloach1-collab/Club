import "server-only";
import { env } from "@/lib/env";
import { AppError, ForbiddenError } from "@/lib/errors";

/**
 * Helpers for the versioned public API (/api/v1) consumed by the club website and future apps.
 * The API calls the same module functions as the portal, so rules cannot diverge.
 */
const allowedOrigins = () => (process.env.API_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** CORS for public, credential-less endpoints: only explicitly configured website origins. */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin || !allowedOrigins().includes(origin)) return {};
  return { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key" };
}

export function json(req: Request, body: unknown, init: { status?: number; cache?: string } = {}) {
  return Response.json(body, { status: init.status ?? 200, headers: { ...corsHeaders(req), "Cache-Control": init.cache ?? "no-store" } });
}

export const preflight = (req: Request) => new Response(null, { status: 204, headers: corsHeaders(req) });

/**
 * Cookie-authenticated, state-changing API calls must come from this site (CSRF defence).
 * Cross-domain website components authenticate differently (see docs/integrations.md).
 */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (origin !== new URL(env.appUrl).origin) throw new ForbiddenError("Cross-site requests are not allowed for this endpoint.");
}

/** Small fixed-window limiter for public write endpoints. Per-process; front with a shared limiter when scaling out. */
const hits = new Map<string, { n: number; reset: number }>();
export function rateLimit(req: Request, bucket: string, limit = 10, windowMs = 60_000) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const cur = hits.get(key);
  if (!cur || cur.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    return;
  }
  if (++cur.n > limit) throw new AppError("rate_limited", "Too many requests. Please try again shortly.", 429);
}
