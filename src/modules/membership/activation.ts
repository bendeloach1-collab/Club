import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import { leads, membershipEvents, membershipMembers, memberships, membershipPlans, payments, persons } from "@/db/schema";
import { addMonths, clubDate } from "@/lib/time";
import { postEntry } from "@/modules/billing/ledger";

type Payment = typeof payments.$inferSelect;

/**
 * Called by the payment state machine when an enrollment payment settles.
 * Posts the itemised charges and activates the membership, exactly once.
 */
export async function activateMembershipFromPayment(tx: Tx, p: Payment): Promise<boolean> {
  const membershipId = p.lineItems.find((li) => li.sourceType === "membership")?.sourceId;
  if (!membershipId) return false;
  const [m] = await tx.select().from(memberships).where(eq(memberships.id, membershipId)).for("update");
  if (!m || m.status !== "pending_payment") return m?.status === "active";
  const [plan] = await tx.select().from(membershipPlans).where(eq(membershipPlans.id, m.planId));

  for (const [i, li] of p.lineItems.entries()) {
    await postEntry(tx, {
      billingAccountId: p.billingAccountId,
      entryType: "charge",
      amountCents: li.amountCents,
      currency: p.currency,
      description: li.description,
      category: li.category,
      sourceType: li.sourceType,
      sourceId: li.sourceId,
      paymentId: p.id,
      idempotencyKey: `payment:${p.id}:item:${i}`,
    });
  }
  const today = clubDate();
  await tx
    .update(memberships)
    .set({
      status: "active",
      startDate: today,
      nextBillingDate: addMonths(today, plan?.billingInterval === "year" ? 12 : 1),
      updatedAt: new Date(),
    })
    .where(eq(memberships.id, m.id));
  await tx.insert(membershipEvents).values({ membershipId: m.id, type: "activated", effectiveDate: today, appliedAt: new Date(), data: { paymentId: p.id } });
  await markLeadsWon(tx, m.id);
  return true;
}

/** Close any open leads belonging to the people on this membership (history is preserved). */
export async function markLeadsWon(tx: Tx, membershipId: string) {
  const members = await tx
    .select({ personId: membershipMembers.personId })
    .from(membershipMembers)
    .innerJoin(persons, eq(persons.id, membershipMembers.personId))
    .where(eq(membershipMembers.membershipId, membershipId));
  if (members.length === 0) return;
  await tx
    .update(leads)
    .set({ stage: "won", convertedMembershipId: membershipId, convertedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        inArray(
          leads.personId,
          members.map((x) => x.personId),
        ),
        inArray(leads.stage, ["new", "contacted", "tour_scheduled", "toured", "proposal"]),
      ),
    );
}
