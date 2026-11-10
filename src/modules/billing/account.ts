import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { billingAccounts, householdMembers, payments } from "@/db/schema";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { can, type Actor } from "@/modules/identity/actor";
import { getBalance, listEntries } from "./ledger";
import { createPayment } from "./payments";

/**
 * Authorise access to a household's financial records: a member needs the explicit
 * `canManageBilling` permission in that household; staff need `billing.view`.
 */
async function authoriseBilling(actor: Actor, householdId: string) {
  if (actor.personId && actor.householdIds.includes(householdId)) {
    const [hm] = await db.select().from(householdMembers).where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.personId, actor.personId)));
    if (!hm?.canManageBilling) throw new ForbiddenError("You do not have access to this household's billing.");
  } else if (actor.roles.length > 0) {
    if (!can(actor, "billing.view")) throw new ForbiddenError();
  } else {
    throw new NotFoundError("Household");
  }
  const [acct] = await db.select().from(billingAccounts).where(eq(billingAccounts.householdId, householdId));
  if (!acct) throw new NotFoundError("Billing account");
  return acct;
}

export async function listEntriesForHousehold(actor: Actor, householdId: string, opts: { limit?: number; offset?: number } = {}) {
  const account = await authoriseBilling(actor, householdId);
  const [entries, balanceCents, recentPayments] = await Promise.all([
    listEntries(db, account.id, opts.limit ?? 50, opts.offset ?? 0),
    getBalance(db, account.id),
    db.select().from(payments).where(eq(payments.billingAccountId, account.id)).orderBy(desc(payments.createdAt)).limit(20),
  ]);
  return { account, entries, balanceCents, payments: recentPayments };
}

/** "Pay Now" against the outstanding club-account balance. */
export async function createBalancePayment(actor: Actor, householdId: string, idempotencyKey: string) {
  const account = await authoriseBilling(actor, householdId);
  if (!actor.householdIds.includes(householdId)) throw new ForbiddenError("Only the household can pay its balance online.");
  const balance = await getBalance(db, account.id);
  if (balance <= 0) throw new ValidationError("There is no balance to pay.");
  const open = await db.select().from(payments).where(and(eq(payments.billingAccountId, account.id), eq(payments.purpose, "account_payment"), inArray(payments.status, ["pending", "requires_action", "processing"])));
  // One in-flight balance payment at a time, so a balance cannot be collected twice.
  if (open[0]) return open[0];
  return createPayment(db, {
    billingAccountId: account.id,
    purpose: "account_payment",
    currency: account.currency,
    lineItems: [{ description: "Club account payment", amountCents: balance, category: "payment" }],
    idempotencyKey: `balance:${account.id}:${idempotencyKey}`,
    createdByUserId: actor.userId,
  });
}

export async function getPaymentForActor(actor: Actor, paymentId: string) {
  const [row] = await db.select({ p: payments, householdId: billingAccounts.householdId }).from(payments).innerJoin(billingAccounts, eq(billingAccounts.id, payments.billingAccountId)).where(eq(payments.id, paymentId));
  if (!row) throw new NotFoundError("Payment");
  if (!actor.householdIds.includes(row.householdId) && !can(actor, "billing.view")) throw new NotFoundError("Payment");
  return row.p;
}
