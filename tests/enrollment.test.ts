import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { account, billingAccounts, documentAcceptances, guardianships, householdMembers, leadActivities, leads, ledgerEntries, membershipMembers, memberships, payments, persons, user } from "@/db/schema";
import { getBalance } from "@/modules/billing/ledger";
import { captureLead } from "@/modules/crm/leads";
import { enroll, retryEnrollmentPayment, type EnrollmentInput } from "@/modules/membership/enrollment";
import { activeMembershipFor } from "@/modules/membership/plans";
import { ensureBase, openCheckout, sandbox, uid } from "./helpers";

const input = (over: Partial<EnrollmentInput> = {}): EnrollmentInput => {
  const k = uid();
  return {
    planCode: "family",
    primary: { firstName: "Robin", lastName: "Hale", email: `${k}@enroll.test`, phone: `706${k.replace(/\D/g, "").padEnd(7, "0").slice(0, 7)}`, dateOfBirth: "1984-05-05", password: "correct-horse-battery" },
    additionalMembers: [
      { firstName: "Sky", lastName: "Hale", dateOfBirth: "1985-06-06", relationship: "adult" },
      { firstName: "Bo", lastName: "Hale", dateOfBirth: "2017-07-07", relationship: "dependent" },
    ],
    acceptAgreement: true,
    acceptWaiver: true,
    marketingEmailOptIn: true,
    idempotencyKey: k,
    ...over,
  };
};

beforeAll(ensureBase);

describe("membership enrollment", () => {
  it("creates consistent person, household, membership and billing records, pending until paid", async () => {
    const r = await enroll(input());
    const members = await db.select().from(householdMembers).where(eq(householdMembers.householdId, r.householdId));
    expect(members.map((m) => m.role).sort()).toEqual(["adult", "dependent", "primary"]);
    const primary = members.find((m) => m.role === "primary")!;
    expect(primary).toMatchObject({ canBookForHousehold: true, canManageBilling: true, canChargeAccount: true });
    // Permissions are explicit: the second adult and the dependent get none by default.
    for (const m of members.filter((x) => x.role !== "primary")) expect(m).toMatchObject({ canBookForHousehold: false, canManageBilling: false, canChargeAccount: false });

    const [m] = await db.select().from(memberships).where(eq(memberships.id, r.membershipId));
    expect(m).toMatchObject({ status: "pending_payment", householdId: r.householdId, billingAccountId: r.billingAccountId, duesCents: 19900 });
    expect(await db.select().from(membershipMembers).where(eq(membershipMembers.membershipId, r.membershipId))).toHaveLength(3);
    const [acct] = await db.select().from(billingAccounts).where(eq(billingAccounts.id, r.billingAccountId));
    expect(acct!.householdId).toBe(r.householdId);

    const [p] = await db.select().from(persons).where(eq(persons.id, r.primaryPersonId));
    expect(p!.userId).toBe(r.userId);
    expect(p!.memberNumber).toMatch(/^AAC-\d+$/);
    const [cred] = await db.select().from(account).where(eq(account.userId, r.userId));
    expect(cred!.providerId).toBe("credential");
    expect(cred!.password).not.toContain("correct-horse");

    expect(await db.select().from(guardianships).where(eq(guardianships.guardianPersonId, r.primaryPersonId))).toHaveLength(1);
    // Agreement + waiver for the primary, waiver for the dependent.
    expect(await db.select().from(documentAcceptances).where(eq(documentAcceptances.membershipId, r.membershipId))).toHaveLength(3);

    const [pay] = await db.select().from(payments).where(eq(payments.id, r.paymentId!));
    expect(pay).toMatchObject({ status: "pending", amountCents: 19900 + 14900, purpose: "enrollment" });
    // Nothing is owed or granted until the processor confirms payment.
    expect(await getBalance(db, r.billingAccountId)).toBe(0);
    expect(await activeMembershipFor(db, r.primaryPersonId)).toBeNull();
  });

  it("activates on confirmed payment and posts itemised, balanced ledger entries", async () => {
    const r = await enroll(input());
    await sandbox().simulate(await openCheckout(r.paymentId!), "success");
    const [m] = await db.select().from(memberships).where(eq(memberships.id, r.membershipId));
    expect(m!.status).toBe("active");
    expect(m!.nextBillingDate).not.toBeNull();
    const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.billingAccountId, r.billingAccountId));
    expect(entries.map((e) => [e.entryType, e.amountCents]).sort()).toEqual([["charge", 14900], ["charge", 19900], ["payment", -34800]].sort());
    expect(await getBalance(db, r.billingAccountId)).toBe(0);
    expect((await activeMembershipFor(db, r.primaryPersonId))?.planCode).toBe("family");
  });

  it("is idempotent: resubmitting the same form does not create a second household or payment", async () => {
    const i = input();
    const [a, b] = await Promise.all([enroll(i).catch((e) => e), enroll(i).catch((e) => e)]);
    const c = await enroll(i);
    const ok = [a, b].filter((x) => !(x instanceof Error));
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const x of ok) expect(x.membershipId).toBe(c.membershipId);
    expect(c.replayed).toBe(true);
    expect(await db.select().from(user).where(eq(user.email, i.primary.email))).toHaveLength(1);
    expect(await db.select().from(payments).where(eq(payments.billingAccountId, c.billingAccountId))).toHaveLength(1);
  });

  it("rejects an email that already has a login, and rolls back everything", async () => {
    const i = input();
    await enroll(i);
    const before = await db.$count(persons);
    await expect(enroll({ ...input(), primary: { ...i.primary } })).rejects.toMatchObject({ code: "email_in_use" });
    expect(await db.$count(persons)).toBe(before);
  });

  it("enforces plan limits and age rules on the server", async () => {
    await expect(enroll(input({ planCode: "individual" }))).rejects.toMatchObject({ code: "too_many_adults" });
    await expect(enroll(input({ planCode: "corporate", additionalMembers: [] }))).rejects.toMatchObject({ code: "plan_unavailable" });
    const minor = input({ additionalMembers: [] });
    minor.primary.dateOfBirth = "2012-01-01";
    await expect(enroll(minor)).rejects.toMatchObject({ code: "primary_under_18" });
  });

  it("converts the matching lead without a duplicate identity and keeps its history", async () => {
    const i = input({ additionalMembers: [] });
    const { leadId } = await captureLead({ firstName: "Robin", lastName: "Hale", email: i.primary.email.toUpperCase(), source: "website", message: "Interested in family membership" });
    const r = await enroll(i);
    let [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(lead).toMatchObject({ personId: r.primaryPersonId, stage: "new" }); // linked, not yet won
    await sandbox().simulate(await openCheckout(r.paymentId!), "success");
    [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(lead).toMatchObject({ stage: "won", convertedMembershipId: r.membershipId, personId: r.primaryPersonId });
    expect(await db.select().from(persons).where(eq(persons.emailNormalized, i.primary.email))).toHaveLength(1);
    const history = await db.select().from(leadActivities).where(eq(leadActivities.leadId, leadId));
    expect(history.some((a) => a.type === "inquiry" && a.body.includes("Interested in family membership"))).toBe(true);
  });

  it("lets a member retry after a failed payment without double-charging", async () => {
    const r = await enroll(input({ additionalMembers: [] }));
    await sandbox().simulate(await openCheckout(r.paymentId!), "cancel");
    const [m] = await db.select().from(memberships).where(eq(memberships.id, r.membershipId));
    expect(m!.status).toBe("pending_payment");
    const retry = await retryEnrollmentPayment(r.userId, r.membershipId, [r.householdId]);
    expect(retry.id).not.toBe(r.paymentId);
    // Asking again while the retry is open returns the same payment.
    expect((await retryEnrollmentPayment(r.userId, r.membershipId, [r.householdId])).id).toBe(retry.id);
    await sandbox().simulate(await openCheckout(retry.id), "success");
    const settled = await db.select().from(payments).where(and(eq(payments.billingAccountId, r.billingAccountId), eq(payments.status, "succeeded")));
    expect(settled).toHaveLength(1);
    expect(await getBalance(db, r.billingAccountId)).toBe(0);
  });
});
