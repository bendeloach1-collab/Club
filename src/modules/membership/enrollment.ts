import { and, desc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db";
import {
  billingAccounts,
  consentEvents,
  documentAcceptances,
  documents,
  guardianships,
  householdMembers,
  households,
  leadActivities,
  leads,
  membershipEvents,
  membershipMembers,
  memberships,
  payments,
  type PaymentLineItem,
} from "@/db/schema";
import { ConflictError, ValidationError } from "@/lib/errors";
import { normalizeEmail, normalizePhone } from "@/lib/normalize";
import { clubDate } from "@/lib/time";
import { audit } from "@/modules/audit/audit";
import { createPayment } from "@/modules/billing/payments";
import { ageOn, createLogin, createPerson } from "@/modules/identity/people";
import { markLeadsWon } from "./activation";
import { getPlanByCode } from "./plans";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const name = z.string().trim().min(1, "Required").max(80);

export const enrollmentSchema = z.object({
  planCode: z.string().min(1),
  primary: z.object({
    firstName: name,
    lastName: name,
    email: z.string().trim().email("Enter a valid email").max(200),
    phone: z.string().trim().min(7, "Enter a phone number").max(30),
    dateOfBirth: dateStr,
    password: z.string().min(10, "Use at least 10 characters").max(128),
  }),
  additionalMembers: z
    .array(z.object({ firstName: name, lastName: name, dateOfBirth: dateStr, relationship: z.enum(["adult", "dependent"]) }))
    .max(12)
    .default([]),
  acceptAgreement: z.literal(true, { message: "You must accept the membership agreement." }),
  acceptWaiver: z.literal(true, { message: "You must accept the liability waiver." }),
  marketingEmailOptIn: z.boolean().default(false),
  marketingSmsOptIn: z.boolean().default(false),
  /** Client-generated key: resubmitting the same form can never enroll twice. */
  idempotencyKey: z.string().min(8).max(100),
});
export type EnrollmentInput = z.input<typeof enrollmentSchema>;

export type EnrollmentResult = {
  householdId: string;
  membershipId: string;
  billingAccountId: string;
  primaryPersonId: string;
  userId: string;
  /** Null when nothing is due and the membership was activated immediately. */
  paymentId: string | null;
  replayed: boolean;
};

/**
 * Public membership enrollment. One transaction creates the login, people, household,
 * explicit permissions, billing account, membership, document acceptances and the pending
 * payment — or nothing at all. The membership becomes active only when the processor
 * confirms payment (see activateMembershipFromPayment).
 */
export async function enroll(rawInput: EnrollmentInput, ctx: { ipAddress?: string | null } = {}): Promise<EnrollmentResult> {
  const input = enrollmentSchema.parse(rawInput);
  const paymentKey = `enroll:${input.idempotencyKey}`;

  return db.transaction(async (tx) => {
    // Idempotent replay: the earlier submission already created everything.
    const [prior] = await tx.select().from(payments).where(eq(payments.idempotencyKey, paymentKey));
    if (prior) {
      const membershipId = prior.lineItems.find((l) => l.sourceType === "membership")!.sourceId!;
      const [m] = await tx.select().from(memberships).where(eq(memberships.id, membershipId));
      const [hm] = await tx
        .select({ personId: householdMembers.personId })
        .from(householdMembers)
        .where(and(eq(householdMembers.householdId, m!.householdId), eq(householdMembers.role, "primary")));
      return {
        householdId: m!.householdId,
        membershipId,
        billingAccountId: prior.billingAccountId,
        primaryPersonId: hm!.personId,
        userId: prior.createdByUserId!,
        paymentId: prior.id,
        replayed: true,
      };
    }

    const plan = await getPlanByCode(tx, input.planCode);
    if (!plan || !plan.isActive || !plan.isPublic) throw new ValidationError("That membership plan is not available.", "plan_unavailable");

    const today = clubDate();
    if (ageOn(input.primary.dateOfBirth, today) < 18) throw new ValidationError("The primary member must be at least 18 years old.", "primary_under_18");
    const adults = 1 + input.additionalMembers.filter((m) => m.relationship === "adult").length;
    const dependents = input.additionalMembers.filter((m) => m.relationship === "dependent").length;
    if (adults > plan.maxAdults) throw new ValidationError(`${plan.name} covers up to ${plan.maxAdults} adult(s).`, "too_many_adults");
    if (dependents > plan.maxDependents) throw new ValidationError(`${plan.name} covers up to ${plan.maxDependents} dependent(s).`, "too_many_dependents");
    for (const m of input.additionalMembers) {
      const age = ageOn(m.dateOfBirth, today);
      if (m.relationship === "adult" && age < 18) throw new ValidationError(`${m.firstName} is under 18 and must be added as a dependent.`);
      if (m.relationship === "dependent" && age >= 26) throw new ValidationError(`${m.firstName} is too old to be added as a dependent.`);
    }

    const docs = await tx.select().from(documents).where(eq(documents.isCurrent, true));
    const agreement = docs.find((d) => d.kind === "membership_agreement");
    const waiver = docs.find((d) => d.kind === "liability_waiver");
    if (!agreement || !waiver) throw new Error("Membership documents are not configured");

    const userId = await createLogin(tx, {
      email: input.primary.email,
      name: `${input.primary.firstName} ${input.primary.lastName}`,
      password: input.primary.password,
    });
    const primary = await createPerson(tx, {
      ...input.primary,
      userId,
      marketingEmailOptIn: input.marketingEmailOptIn,
      marketingSmsOptIn: input.marketingSmsOptIn,
    });
    const [household] = await tx.insert(households).values({ name: `${primary.lastName} Household` }).returning();
    const [billing] = await tx.insert(billingAccounts).values({ householdId: household!.id, currency: plan.currency }).returning();

    // Permissions are explicit rows, never implied by role.
    await tx.insert(householdMembers).values({
      householdId: household!.id,
      personId: primary.id,
      role: "primary",
      canBookForHousehold: true,
      canManageBilling: true,
      canChargeAccount: true,
    });
    const [membership] = await tx
      .insert(memberships)
      .values({ householdId: household!.id, planId: plan.id, billingAccountId: billing!.id, status: "pending_payment", startDate: today, duesCents: plan.duesCents, currency: plan.currency })
      .returning();
    await tx.insert(membershipMembers).values({ membershipId: membership!.id, personId: primary.id });

    const acceptances = [
      { documentId: agreement.id, personId: primary.id },
      { documentId: waiver.id, personId: primary.id },
    ];
    for (const m of input.additionalMembers) {
      const person = await createPerson(tx, { firstName: m.firstName, lastName: m.lastName, dateOfBirth: m.dateOfBirth });
      await tx.insert(householdMembers).values({ householdId: household!.id, personId: person.id, role: m.relationship });
      await tx.insert(membershipMembers).values({ membershipId: membership!.id, personId: person.id });
      if (m.relationship === "dependent") {
        // Declared by the enrolling adult; staff verify before Kids Club pickup authority is granted.
        await tx.insert(guardianships).values({ guardianPersonId: primary.id, childPersonId: person.id });
        acceptances.push({ documentId: waiver.id, personId: person.id });
      }
    }
    await tx.insert(documentAcceptances).values(
      acceptances.map((a) => ({ ...a, acceptedByPersonId: primary.id, membershipId: membership!.id, ipAddress: ctx.ipAddress ?? null })),
    );
    await tx.insert(consentEvents).values([
      { personId: primary.id, channel: "email", granted: input.marketingEmailOptIn, source: "enrollment" },
      { personId: primary.id, channel: "sms", granted: input.marketingSmsOptIn, source: "enrollment" },
    ]);
    await tx.insert(membershipEvents).values({
      membershipId: membership!.id,
      type: "created",
      effectiveDate: today,
      appliedAt: new Date(),
      createdByUserId: userId,
      data: { planCode: plan.code, duesCents: plan.duesCents, enrollmentFeeCents: plan.enrollmentFeeCents },
    });

    await linkLeadsToPerson(tx, primary.id, input.primary.email, input.primary.phone);

    const lineItems: PaymentLineItem[] = [];
    if (plan.enrollmentFeeCents > 0) {
      lineItems.push({ description: `${plan.name} enrollment fee`, amountCents: plan.enrollmentFeeCents, category: "enrollment_fee", sourceType: "membership", sourceId: membership!.id });
    }
    if (plan.duesCents > 0) {
      lineItems.push({
        description: `${plan.name} dues (first ${plan.billingInterval})`,
        amountCents: plan.duesCents,
        category: "membership_dues",
        sourceType: "membership",
        sourceId: membership!.id,
      });
    }

    let paymentId: string | null = null;
    if (lineItems.length > 0) {
      const payment = await createPayment(tx, { billingAccountId: billing!.id, purpose: "enrollment", currency: plan.currency, lineItems, idempotencyKey: paymentKey, createdByUserId: userId });
      paymentId = payment.id;
    } else {
      await tx.update(memberships).set({ status: "active" }).where(eq(memberships.id, membership!.id));
      await tx.insert(membershipEvents).values({ membershipId: membership!.id, type: "activated", effectiveDate: today, appliedAt: new Date() });
      await markLeadsWon(tx, membership!.id);
    }

    await audit(tx, {
      actorUserId: userId,
      action: "membership.enrolled",
      entityType: "membership",
      entityId: membership!.id,
      householdId: household!.id,
      data: { planCode: plan.code, members: 1 + input.additionalMembers.length },
    });

    return { householdId: household!.id, membershipId: membership!.id, billingAccountId: billing!.id, primaryPersonId: primary.id, userId, paymentId, replayed: false };
  });
}

/**
 * Attach open leads with the same contact details to the newly created person, so the
 * prospect's history follows them into membership instead of spawning a second identity.
 */
async function linkLeadsToPerson(tx: Tx, personId: string, email: string, phone: string) {
  const e = normalizeEmail(email);
  const ph = normalizePhone(phone);
  const conds = [];
  if (e) conds.push(eq(leads.emailNormalized, e));
  if (ph) conds.push(eq(leads.phoneNormalized, ph));
  if (conds.length === 0) return;
  const open = await tx
    .select({ id: leads.id })
    .from(leads)
    .where(and(or(...conds), inArray(leads.stage, ["new", "contacted", "tour_scheduled", "toured", "proposal"])))
    .orderBy(desc(leads.createdAt));
  if (open.length === 0) return;
  const ids = open.map((l) => l.id);
  await tx.update(leads).set({ personId, lastActivityAt: new Date(), updatedAt: new Date() }).where(inArray(leads.id, ids));
  await tx.insert(leadActivities).values(ids.map((leadId) => ({ leadId, type: "system" as const, body: "Started online enrollment." })));
}

/** A new payment attempt for a membership still awaiting its first payment. */
export async function retryEnrollmentPayment(actorUserId: string, membershipId: string, householdIds: string[]) {
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(memberships).where(eq(memberships.id, membershipId)).for("update");
    if (!m || !householdIds.includes(m.householdId)) throw new ValidationError("Membership not found.");
    if (m.status !== "pending_payment") throw new ConflictError("This membership is not awaiting payment.");
    const prior = await tx.select().from(payments).where(and(eq(payments.billingAccountId, m.billingAccountId), eq(payments.purpose, "enrollment"))).orderBy(desc(payments.createdAt));
    const live = prior.find((p) => ["pending", "requires_action", "processing"].includes(p.status));
    if (live) return live;
    const last = prior[0];
    if (!last) throw new ConflictError("No enrollment payment found.");
    return createPayment(tx, {
      billingAccountId: m.billingAccountId,
      purpose: "enrollment",
      currency: last.currency,
      lineItems: last.lineItems,
      idempotencyKey: `enroll-retry:${m.id}:${prior.length}`,
      createdByUserId: actorUserId,
    });
  });
}
