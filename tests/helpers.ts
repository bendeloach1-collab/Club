import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { insertBaseData } from "@/db/base-data";
import { billingAccounts, householdMembers, households, membershipMembers, membershipPlans, memberships, services, sessions, staffRoles, user, type StaffRole } from "@/db/schema";
import { clubDate } from "@/lib/time";
import { startCheckout } from "@/modules/billing/payments";
import { getPaymentProvider } from "@/modules/billing/providers";
import type { SandboxProvider } from "@/modules/billing/providers/sandbox";
import { loadActor, type Actor } from "@/modules/identity/actor";
import { createPerson } from "@/modules/identity/people";

export const sandbox = () => getPaymentProvider() as SandboxProvider;
export const uid = () => randomUUID();

let baseReady: Promise<void> | undefined;
export const ensureBase = () => (baseReady ??= insertBaseData(db));

export async function makeStaff(...roles: StaffRole[]): Promise<Actor> {
  const id = uid();
  await db.insert(user).values({ id, name: `Staff ${roles.join("+")}`, email: `${id}@staff.test` });
  await db.insert(staffRoles).values(roles.map((role) => ({ userId: id, role })));
  return loadActor(id);
}

export type TestHousehold = {
  actor: Actor & { personId: string };
  householdId: string;
  billingAccountId: string;
  membershipId: string;
  adultId: string;
  childId: string;
};

/**
 * Fast fixture: an active household (primary + second adult + child) inserted directly.
 * Enrollment itself is covered by enrollment.test.ts through the real code path.
 */
export async function makeHousehold(opts: { planCode?: string; status?: "active" | "frozen" | "cancelled" | "pending_payment"; chargeEnabled?: boolean; creditLimitCents?: number } = {}): Promise<TestHousehold> {
  await ensureBase();
  const userId = uid();
  await db.insert(user).values({ id: userId, name: "Test Member", email: `${userId}@member.test` });
  const primary = await createPerson(db, { firstName: "Pat", lastName: `T${userId.slice(0, 6)}`, email: `${userId}@member.test`, dateOfBirth: "1985-01-01", userId });
  const adult = await createPerson(db, { firstName: "Alex", lastName: primary.lastName, dateOfBirth: "1986-01-01" });
  const child = await createPerson(db, { firstName: "Kid", lastName: primary.lastName, dateOfBirth: "2016-01-01" });
  const [hh] = await db.insert(households).values({ name: `${primary.lastName} Household` }).returning();
  const [acct] = await db.insert(billingAccounts).values({ householdId: hh!.id, chargeEnabled: opts.chargeEnabled ?? false, creditLimitCents: opts.creditLimitCents ?? 0 }).returning();
  await db.insert(householdMembers).values([
    { householdId: hh!.id, personId: primary.id, role: "primary", canBookForHousehold: true, canManageBilling: true, canChargeAccount: true },
    { householdId: hh!.id, personId: adult.id, role: "adult" },
    { householdId: hh!.id, personId: child.id, role: "dependent" },
  ]);
  const [plan] = await db.select().from(membershipPlans).where(eq(membershipPlans.code, opts.planCode ?? "family"));
  const [m] = await db.insert(memberships).values({ householdId: hh!.id, planId: plan!.id, billingAccountId: acct!.id, status: opts.status ?? "active", startDate: clubDate(), duesCents: plan!.duesCents }).returning();
  await db.insert(membershipMembers).values([primary, adult, child].map((p) => ({ membershipId: m!.id, personId: p.id })));
  const actor = (await loadActor(userId)) as Actor & { personId: string };
  return { actor, householdId: hh!.id, billingAccountId: acct!.id, membershipId: m!.id, adultId: adult.id, childId: child.id };
}

export async function makeSession(opts: { slug?: string; capacity?: number; startsInHours?: number; priceCents?: number } = {}) {
  await ensureBase();
  const slug = `svc-${uid().slice(0, 8)}`;
  const [svc] = opts.slug
    ? await db.select().from(services).where(eq(services.slug, opts.slug))
    : await db.insert(services).values({ slug, name: `Test ${slug}`, category: "class", memberPriceCents: opts.priceCents ?? 0, defaultCapacity: opts.capacity ?? 10, cancelWindowHours: 12 }).returning();
  const startsAt = new Date(Date.now() + (opts.startsInHours ?? 48) * 3600 * 1000);
  const [s] = await db.insert(sessions).values({ serviceId: svc!.id, startsAt, endsAt: new Date(startsAt.getTime() + 3600 * 1000), capacity: opts.capacity ?? svc!.defaultCapacity }).returning();
  return { service: svc!, session: s! };
}

export const bookArgs = (h: TestHousehold, sessionId: string, priceCents: number, method: "included" | "pay_now" | "club_account", participant?: string) => ({
  sessionId,
  participantPersonId: participant ?? h.actor.personId,
  paymentMethod: method,
  acceptedPolicyVersion: 1,
  acceptedPriceCents: priceCents,
  idempotencyKey: uid(),
});

/** Open the sandbox checkout for a payment and return its checkout id. */
export async function openCheckout(paymentId: string) {
  const { payment } = await startCheckout(paymentId, { successPath: "/ok", cancelPath: "/cancel" });
  return payment.providerCheckoutId!;
}

/** Outcome summary for Promise.allSettled results. */
export function tally<T>(results: PromiseSettledResult<T>[]) {
  const ok = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<T>[];
  const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  return { ok, failed, codes: failed.map((f) => (f.reason as { code?: string }).code ?? String(f.reason)) };
}
