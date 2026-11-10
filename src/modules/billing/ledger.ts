import { and, desc, eq, sql } from "drizzle-orm";
import type { DbOrTx, Tx } from "@/db";
import { billingAccounts, householdMembers, ledgerEntries, LEDGER_ENTRY_TYPES } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError, PG_UNIQUE_VIOLATION, pgErrorCode, ValidationError } from "@/lib/errors";

export type LedgerEntryInput = {
  billingAccountId: string;
  entryType: (typeof LEDGER_ENTRY_TYPES)[number];
  /** Signed minor units: positive increases what the household owes. */
  amountCents: number;
  currency: string;
  description: string;
  category: string;
  idempotencyKey: string;
  personId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  paymentId?: string | null;
  reversesEntryId?: string | null;
  createdByUserId?: string | null;
};

/**
 * Post an immutable ledger entry. Posting is idempotent on `idempotencyKey`:
 * a repeat returns the original entry and `created: false` instead of a second row.
 */
export async function postEntry(tx: DbOrTx, input: LedgerEntryInput) {
  if (!Number.isInteger(input.amountCents) || input.amountCents === 0) throw new ValidationError("Ledger amount must be a non-zero integer.");
  const sign = Math.sign(input.amountCents);
  const expected = { charge: 1, refund: 1, payment: -1, credit: -1, reversal: 0 }[input.entryType];
  if (expected !== 0 && sign !== expected) throw new ValidationError(`A ${input.entryType} entry has the wrong sign.`);
  const [row] = await tx
    .insert(ledgerEntries)
    .values({ ...input, currency: input.currency.toLowerCase() })
    .onConflictDoNothing({ target: ledgerEntries.idempotencyKey })
    .returning();
  if (row) return { entry: row, created: true };
  const [existing] = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, input.idempotencyKey));
  if (!existing) throw new Error("ledger idempotency lookup failed");
  return { entry: existing, created: false };
}

/** Current balance in minor units. Positive = household owes AAC; negative = credit on account. */
export async function getBalance(tx: DbOrTx, billingAccountId: string): Promise<number> {
  const [r] = await tx
    .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amountCents}), 0)` })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.billingAccountId, billingAccountId));
  return Number(r?.total ?? 0);
}

export async function listEntries(tx: DbOrTx, billingAccountId: string, limit = 50, offset = 0) {
  return tx
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.billingAccountId, billingAccountId))
    .orderBy(desc(ledgerEntries.postedAt), desc(ledgerEntries.id))
    .limit(limit)
    .offset(offset);
}

/** Explicit reversal of a posted entry. The unique index allows each entry to be reversed once. */
export async function reverseEntry(tx: DbOrTx, entryId: string, reason: string, createdByUserId: string | null) {
  const [orig] = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.id, entryId));
  if (!orig) throw new NotFoundError("Ledger entry");
  if (orig.entryType === "reversal") throw new ValidationError("A reversal cannot itself be reversed.");
  try {
    return await postEntry(tx, {
      billingAccountId: orig.billingAccountId,
      entryType: "reversal",
      amountCents: -orig.amountCents,
      currency: orig.currency,
      description: `Reversal: ${orig.description} (${reason})`,
      category: orig.category,
      personId: orig.personId,
      sourceType: orig.sourceType,
      sourceId: orig.sourceId,
      reversesEntryId: orig.id,
      idempotencyKey: `reversal:${orig.id}`,
      createdByUserId,
    });
  } catch (e) {
    if (pgErrorCode(e) === PG_UNIQUE_VIOLATION) throw new ConflictError("This entry has already been reversed.");
    throw e;
  }
}

export type ChargeToAccountInput = {
  billingAccountId: string;
  householdId: string;
  /** The adult authorising the charge. */
  actorPersonId: string;
  amountCents: number;
  description: string;
  category: string;
  idempotencyKey: string;
  personId?: string | null;
  sourceType?: string;
  sourceId?: string;
  createdByUserId?: string | null;
};

/**
 * "Charge to Club Account". Must run inside a transaction: the billing account row is
 * locked so concurrent charges are serialised and can never jointly exceed the limit.
 */
export async function chargeToAccount(tx: Tx, input: ChargeToAccountInput) {
  const [acct] = await tx.select().from(billingAccounts).where(eq(billingAccounts.id, input.billingAccountId)).for("update");
  if (!acct || acct.householdId !== input.householdId) throw new NotFoundError("Billing account");
  const [perm] = await tx
    .select()
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, input.householdId), eq(householdMembers.personId, input.actorPersonId)));
  if (!perm?.canChargeAccount) throw new ForbiddenError("You are not authorised to charge to the club account.");
  if (!acct.chargeEnabled) throw new ForbiddenError("Club-account charging is not enabled for this household.");
  if (acct.status !== "active") throw new ForbiddenError("This club account is suspended. Please pay the outstanding balance.");
  if (perm.chargeLimitCents !== null && input.amountCents > perm.chargeLimitCents) {
    throw new ForbiddenError("This charge exceeds your per-charge spending limit.");
  }
  // Idempotent replays must not be rejected by the limit they themselves consumed.
  const [prior] = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, input.idempotencyKey));
  if (prior) return { entry: prior, created: false };
  const balance = await getBalance(tx, acct.id);
  if (balance + input.amountCents > acct.creditLimitCents) {
    throw new ConflictError("This charge would exceed the club-account limit.", "account_limit_exceeded");
  }
  return postEntry(tx, {
    billingAccountId: acct.id,
    entryType: "charge",
    amountCents: input.amountCents,
    currency: acct.currency,
    description: input.description,
    category: input.category,
    personId: input.personId ?? input.actorPersonId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    idempotencyKey: input.idempotencyKey,
    createdByUserId: input.createdByUserId,
  });
}
