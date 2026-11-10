import type { DbOrTx } from "@/db";
import { auditLog } from "@/db/schema";

export type AuditInput = {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  householdId?: string | null;
  /** Identifiers and non-sensitive facts only. */
  data?: Record<string, unknown>;
};

/** Append an audit record in the caller's transaction so it commits or rolls back with the change. */
export async function audit(tx: DbOrTx, input: AuditInput) {
  await tx.insert(auditLog).values({
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    householdId: input.householdId ?? null,
    data: input.data ?? {},
  });
}
