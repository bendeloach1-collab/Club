import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import type { DbOrTx } from "@/db";
import { account, persons, user } from "@/db/schema";
import { ConflictError, PG_UNIQUE_VIOLATION, pgErrorCode } from "@/lib/errors";
import { normalizeEmail, normalizePhone } from "@/lib/normalize";

export type NewPerson = {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  userId?: string | null;
  marketingEmailOptIn?: boolean;
  marketingSmsOptIn?: boolean;
};

export async function createPerson(tx: DbOrTx, p: NewPerson) {
  const [row] = await tx
    .insert(persons)
    .values({
      firstName: p.firstName.trim(),
      lastName: p.lastName.trim(),
      email: p.email?.trim() || null,
      emailNormalized: normalizeEmail(p.email),
      phone: p.phone?.trim() || null,
      phoneNormalized: normalizePhone(p.phone),
      dateOfBirth: p.dateOfBirth || null,
      userId: p.userId ?? null,
      marketingEmailOptIn: p.marketingEmailOptIn ?? false,
      marketingSmsOptIn: p.marketingSmsOptIn ?? false,
      memberNumber: sql`'AAC-' || nextval('member_number_seq')`,
    })
    .returning();
  return row!;
}

/**
 * Create a credential login in the caller's transaction, using Better Auth's own password
 * hashing and table layout so the account signs in through the normal Better Auth flow.
 */
export async function createLogin(tx: DbOrTx, input: { email: string; name: string; password: string }) {
  const email = normalizeEmail(input.email)!;
  const id = randomUUID();
  try {
    await tx.insert(user).values({ id, name: input.name, email, emailVerified: false });
  } catch (e) {
    if (pgErrorCode(e) === PG_UNIQUE_VIOLATION) throw new ConflictError("An account with this email already exists. Please sign in instead.", "email_in_use");
    throw e;
  }
  await tx.insert(account).values({ id: randomUUID(), accountId: id, providerId: "credential", userId: id, password: await hashPassword(input.password) });
  return id;
}

export async function emailHasLogin(tx: DbOrTx, email: string) {
  const [u] = await tx.select({ id: user.id }).from(user).where(eq(user.email, normalizeEmail(email) ?? ""));
  return Boolean(u);
}

export function ageOn(dateOfBirth: string, onDate: string): number {
  const [by, bm, bd] = dateOfBirth.split("-").map(Number) as [number, number, number];
  const [y, m, d] = onDate.split("-").map(Number) as [number, number, number];
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age--;
  return age;
}
