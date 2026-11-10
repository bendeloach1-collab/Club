import { and, asc, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { documents, membershipMembers, memberships, membershipPlans } from "@/db/schema";

export type Plan = typeof membershipPlans.$inferSelect;

/** Plans offered publicly. This is the single source used by the site, the API and enrollment. */
export async function listPublicPlans(tx: DbOrTx = db) {
  return tx
    .select()
    .from(membershipPlans)
    .where(and(eq(membershipPlans.isPublic, true), eq(membershipPlans.isActive, true)))
    .orderBy(asc(membershipPlans.sortOrder));
}

export async function getPlanByCode(tx: DbOrTx, code: string) {
  const [p] = await tx.select().from(membershipPlans).where(eq(membershipPlans.code, code));
  return p ?? null;
}

export async function currentDocuments(tx: DbOrTx = db) {
  return tx.select().from(documents).where(eq(documents.isCurrent, true)).orderBy(asc(documents.kind));
}

/** Server-side entitlement check used by booking, check-in and partner visibility. */
export async function activeMembershipFor(tx: DbOrTx, personId: string) {
  const [row] = await tx
    .select({ membershipId: memberships.id, planId: memberships.planId, planCode: membershipPlans.code, planName: membershipPlans.name, householdId: memberships.householdId })
    .from(membershipMembers)
    .innerJoin(memberships, eq(memberships.id, membershipMembers.membershipId))
    .innerJoin(membershipPlans, eq(membershipPlans.id, memberships.planId))
    .where(and(eq(membershipMembers.personId, personId), eq(memberships.status, "active")));
  return row ?? null;
}
