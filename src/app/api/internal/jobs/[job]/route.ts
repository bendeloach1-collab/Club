import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { log, reportError } from "@/lib/log";
import { reconcileOpenPayments } from "@/modules/billing/payments";
import { expireLapsedHolds } from "@/modules/booking/engine";
import { applyDueMembershipChanges } from "@/modules/membership/lifecycle";

export const dynamic = "force-dynamic";

const JOBS: Record<string, () => Promise<unknown>> = {
  /** Every few minutes. */
  "reconcile-payments": () => reconcileOpenPayments(),
  /** Every minute or two. */
  "expire-holds": async () => ({ expired: await expireLapsedHolds() }),
  /** Daily, shortly after midnight Eastern. */
  "membership-changes": () => applyDueMembershipChanges(),
};

/**
 * Maintenance jobs, triggered by an external scheduler (cron) with a shared secret:
 *   POST /api/internal/jobs/<job>   Authorization: Bearer $JOBS_SECRET
 * Jobs are idempotent, so overlapping or repeated runs are safe.
 */
export async function POST(req: Request, { params }: { params: Promise<{ job: string }> }) {
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${env.jobsSecret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { job } = await params;
  const run = JOBS[job];
  if (!run) return Response.json({ error: "unknown job" }, { status: 404 });
  const started = Date.now();
  try {
    const result = await run();
    log.info("job.completed", { job, ms: Date.now() - started });
    return Response.json({ job, result });
  } catch (e) {
    reportError("job.failed", e, { job });
    return Response.json({ job, error: "failed" }, { status: 500 });
  }
}
