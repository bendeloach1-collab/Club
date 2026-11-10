import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx, type Tx } from "@/db";
import {
  billingAccounts,
  bookings,
  householdMembers,
  ledgerEntries,
  partnerServices,
  persons,
  resourceReservations,
  resources,
  services,
  sessions,
  user,
  type BookingTerms,
} from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError, PG_EXCLUSION_VIOLATION, PG_UNIQUE_VIOLATION, pgConstraint, pgErrorCode, ValidationError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { addDays, clubDate, clubTimeToUtc, weekdayOf } from "@/lib/time";
import { audit } from "@/modules/audit/audit";
import { chargeToAccount, postEntry, reverseEntry } from "@/modules/billing/ledger";
import { createPayment, refundPaymentInternal } from "@/modules/billing/payments";
import { assertCan, can, type Actor } from "@/modules/identity/actor";
import { activeMembershipFor } from "@/modules/membership/plans";
import { countLiveBookings, liveBookingFilter } from "./fulfillment";

export const HOLD_MINUTES = 15;

type Service = typeof services.$inferSelect;
type Session = typeof sessions.$inferSelect;

/** The price and policy shown to the member; stored verbatim on the booking when accepted. */
export function termsFor(service: Service): BookingTerms {
  const price = service.memberPriceCents;
  const parts = [
    price > 0 ? `Price ${formatMoney(price, service.currency)}.` : "Included with membership.",
    `Free cancellation until ${service.cancelWindowHours} hours before the start time.`,
    price > 0 ? "Later cancellations are not refunded." : service.lateCancelFeeCents > 0 ? `Later cancellations incur a ${formatMoney(service.lateCancelFeeCents, service.currency)} fee.` : null,
    service.noShowFeeCents > 0 ? `No-shows incur a ${formatMoney(service.noShowFeeCents, service.currency)} fee.` : null,
  ];
  return {
    policyVersion: service.policyVersion,
    priceCents: price,
    currency: service.currency,
    cancelWindowHours: service.cancelWindowHours,
    lateCancelFeeCents: service.lateCancelFeeCents,
    noShowFeeCents: service.noShowFeeCents,
    summary: parts.filter(Boolean).join(" "),
  };
}

/* ------------------------------ Schedule -------------------------------- */

export type ScheduleItem = {
  sessionId: string;
  serviceId: string;
  serviceName: string;
  serviceSlug: string;
  category: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  booked: number;
  spotsLeft: number;
  priceCents: number;
  currency: string;
  coachName: string | null;
  location: string | null;
};

/** Calendar feed for a date range: one indexed range scan plus one grouped count. Public data only. */
export async function listSessions(opts: { from: Date; to: Date; category?: string }, tx: DbOrTx = db): Promise<ScheduleItem[]> {
  const rows = await tx
    .select({
      sessionId: sessions.id,
      serviceId: services.id,
      serviceName: services.name,
      serviceSlug: services.slug,
      category: services.category,
      startsAt: sessions.startsAt,
      endsAt: sessions.endsAt,
      capacity: sessions.capacity,
      priceCents: services.memberPriceCents,
      currency: services.currency,
      coachName: user.name,
      location: sql<string | null>`coalesce(${sessions.location}, ${resources.name})`,
      booked: sql<number>`(select count(*)::int from bookings where bookings.session_id = ${sessions.id} and ${liveBookingFilter})`,
    })
    .from(sessions)
    .innerJoin(services, eq(services.id, sessions.serviceId))
    .leftJoin(user, eq(user.id, sessions.coachUserId))
    .leftJoin(resources, eq(resources.id, sessions.resourceId))
    .where(
      and(
        gte(sessions.startsAt, opts.from),
        lt(sessions.startsAt, opts.to),
        eq(sessions.status, "scheduled"),
        eq(services.isActive, true),
        eq(services.bookingMode, "native"),
        opts.category ? eq(services.category, opts.category as Service["category"]) : undefined,
      ),
    )
    .orderBy(asc(sessions.startsAt), asc(sessions.id))
    .limit(500);
  return rows.map((r) => ({ ...r, spotsLeft: Math.max(0, r.capacity - r.booked) }));
}

/** Services (native and partner-managed) for the Book page. */
export async function listServices(tx: DbOrTx = db) {
  return tx
    .select({ service: services, partnerSlug: partnerServices.slug, partnerName: partnerServices.name, partnerStatus: partnerServices.status })
    .from(services)
    .leftJoin(partnerServices, eq(partnerServices.id, services.partnerServiceId))
    .where(eq(services.isActive, true))
    .orderBy(asc(services.category), asc(services.name));
}

/* ------------------------------ Booking --------------------------------- */

async function authoriseBookingFor(tx: DbOrTx, actor: Actor, participantPersonId: string) {
  if (!actor.personId) throw new ForbiddenError("Only members can make bookings.");
  const rows = await tx.select().from(householdMembers).where(inArray(householdMembers.personId, [actor.personId, participantPersonId]));
  const mine = rows.filter((r) => r.personId === actor.personId);
  const shared = mine.find((m) => rows.some((r) => r.personId === participantPersonId && r.householdId === m.householdId));
  // Participants outside the caller's household are indistinguishable from non-existent ones.
  if (!shared) throw new NotFoundError("Participant");
  if (mine.find((m) => m.householdId === shared.householdId)!.role === "dependent") throw new ForbiddenError("Dependents cannot make bookings.");
  if (participantPersonId !== actor.personId && !shared.canBookForHousehold) {
    throw new ForbiddenError("You do not have permission to book for other household members.");
  }
  return { householdId: shared.householdId, perm: shared };
}

export type BookingQuote = {
  session: Session;
  service: Service;
  terms: BookingTerms;
  spotsLeft: number;
  eligible: boolean;
  ineligibleReason: string | null;
  paymentOptions: ("included" | "pay_now" | "club_account")[];
};

function windowProblem(service: Service, session: Session, now: Date): string | null {
  if (session.status !== "scheduled") return "This session has been cancelled.";
  if (session.startsAt.getTime() <= now.getTime()) return "This session has already started.";
  const opens = addDays(clubDate(session.startsAt), -service.bookingWindowDays);
  if (clubDate(now) < opens) return `Booking opens ${service.bookingWindowDays} days before the session.`;
  return null;
}

/** What the member sees before confirming: price, policy, availability and payment options. */
export async function quoteBooking(actor: Actor, sessionId: string, participantPersonId: string, tx: DbOrTx = db): Promise<BookingQuote> {
  const [row] = await tx.select({ session: sessions, service: services }).from(sessions).innerJoin(services, eq(services.id, sessions.serviceId)).where(eq(sessions.id, sessionId));
  if (!row) throw new NotFoundError("Session");
  const { householdId, perm } = await authoriseBookingFor(tx, actor, participantPersonId);
  const terms = termsFor(row.service);
  const [{ n: booked } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(bookings).where(and(eq(bookings.sessionId, sessionId), liveBookingFilter));
  let reason = windowProblem(row.service, row.session, new Date());
  if (!reason && row.service.bookingMode !== "native") reason = "This service is booked with a partner, not through AAC.";
  if (!reason && row.service.requiresMembership && !(await activeMembershipFor(tx, participantPersonId))) reason = "An active membership is required to book this session.";
  const spotsLeft = Math.max(0, row.session.capacity - booked);
  if (!reason && spotsLeft === 0) reason = "This session is full.";
  const [acct] = await tx.select().from(billingAccounts).where(eq(billingAccounts.householdId, householdId));
  const options: BookingQuote["paymentOptions"] = [];
  if (terms.priceCents === 0) options.push("included");
  else {
    options.push("pay_now");
    if (perm.canChargeAccount && acct?.chargeEnabled && acct.status === "active") options.push("club_account");
  }
  return { session: row.session, service: row.service, terms, spotsLeft, eligible: !reason, ineligibleReason: reason, paymentOptions: options };
}

export const bookSessionSchema = z.object({
  sessionId: z.string().uuid(),
  participantPersonId: z.string().uuid(),
  paymentMethod: z.enum(["included", "pay_now", "club_account"]),
  /** The price and policy version the member was shown. */
  acceptedPolicyVersion: z.number().int(),
  acceptedPriceCents: z.number().int().min(0),
  idempotencyKey: z.string().min(8).max(100),
});

export type BookingResult = { booking: typeof bookings.$inferSelect; paymentId: string | null; replayed: boolean };

/**
 * Book a seat in a scheduled session. Everything is decided inside one transaction that
 * holds the session row lock, so concurrent requests are serialised: capacity, eligibility,
 * the accepted price/terms and (for club-account charges) the credit limit are re-checked
 * against committed state before the booking exists.
 */
export async function bookSession(actor: Actor, raw: z.input<typeof bookSessionSchema>): Promise<BookingResult> {
  const input = bookSessionSchema.parse(raw);
  const key = `book:${actor.userId}:${input.idempotencyKey}`;
  try {
    return await db.transaction(async (tx) => {
      const [prior] = await tx.select().from(bookings).where(eq(bookings.idempotencyKey, key));
      if (prior) return { booking: prior, paymentId: prior.paymentId, replayed: true };

      const { householdId } = await authoriseBookingFor(tx, actor, input.participantPersonId);
      const [session] = await tx.select().from(sessions).where(eq(sessions.id, input.sessionId)).for("update");
      if (!session) throw new NotFoundError("Session");
      const [service] = await tx.select().from(services).where(eq(services.id, session.serviceId));
      if (!service || !service.isActive) throw new NotFoundError("Service");
      if (service.bookingMode !== "native") throw new ValidationError("This service is booked with a partner, not through AAC.", "partner_managed");

      const problem = windowProblem(service, session, new Date());
      if (problem) throw new ConflictError(problem, "not_bookable");
      if (service.requiresMembership && !(await activeMembershipFor(tx, input.participantPersonId))) {
        throw new ForbiddenError("An active membership is required to book this session.");
      }

      const terms = termsFor(service);
      if (terms.policyVersion !== input.acceptedPolicyVersion || terms.priceCents !== input.acceptedPriceCents) {
        throw new ConflictError("The price or policy for this session has changed. Please review and confirm again.", "terms_changed");
      }
      const method = terms.priceCents === 0 ? "included" : input.paymentMethod;
      if (terms.priceCents > 0 && method === "included") throw new ValidationError("Choose how to pay for this session.");

      // Release lapsed holds so they neither take a seat nor block the participant.
      await tx
        .update(bookings)
        .set({ status: "expired", cancelReason: "hold_expired", updatedAt: new Date() })
        .where(and(eq(bookings.sessionId, session.id), eq(bookings.status, "pending_payment"), sql`${bookings.holdExpiresAt} <= now()`));

      if ((await countLiveBookings(tx, session.id)) >= session.capacity) throw new ConflictError("This session is full.", "session_full");

      const [acct] = await tx.select().from(billingAccounts).where(eq(billingAccounts.householdId, householdId));
      if (!acct) throw new NotFoundError("Billing account");

      const [booking] = await tx
        .insert(bookings)
        .values({
          serviceId: service.id,
          sessionId: session.id,
          personId: input.participantPersonId,
          bookedByPersonId: actor.personId!,
          householdId,
          status: method === "pay_now" ? "pending_payment" : "confirmed",
          priceCents: terms.priceCents,
          currency: terms.currency,
          terms,
          paymentMethod: method,
          holdExpiresAt: method === "pay_now" ? new Date(Date.now() + HOLD_MINUTES * 60 * 1000) : null,
          idempotencyKey: key,
        })
        .returning();

      let paymentId: string | null = null;
      const description = `${service.name} — ${clubDate(session.startsAt)}`;
      if (method === "club_account") {
        await chargeToAccount(tx, {
          billingAccountId: acct.id,
          householdId,
          actorPersonId: actor.personId!,
          amountCents: terms.priceCents,
          description,
          category: "booking",
          personId: input.participantPersonId,
          sourceType: "booking",
          sourceId: booking!.id,
          idempotencyKey: `booking:${booking!.id}:charge`,
          createdByUserId: actor.userId,
        });
      } else if (method === "pay_now") {
        const payment = await createPayment(tx, {
          billingAccountId: acct.id,
          purpose: "booking",
          currency: terms.currency,
          lineItems: [{ description, amountCents: terms.priceCents, category: "booking", sourceType: "booking", sourceId: booking!.id, personId: input.participantPersonId }],
          idempotencyKey: `booking:${booking!.id}`,
          createdByUserId: actor.userId,
        });
        paymentId = payment.id;
        await tx.update(bookings).set({ paymentId }).where(eq(bookings.id, booking!.id));
        booking!.paymentId = paymentId;
      }
      await audit(tx, { actorUserId: actor.userId, action: "booking.created", entityType: "booking", entityId: booking!.id, householdId, data: { sessionId: session.id, method, priceCents: terms.priceCents } });
      return { booking: booking!, paymentId, replayed: false };
    });
  } catch (e) {
    if (pgErrorCode(e) === PG_UNIQUE_VIOLATION) {
      const c = pgConstraint(e);
      if (c === "bookings_one_live_per_person_session") throw new ConflictError("This person is already booked into this session.", "already_booked");
      if (c === "bookings_idempotency_key_unique") {
        const [prior] = await db.select().from(bookings).where(eq(bookings.idempotencyKey, key));
        if (prior) return { booking: prior, paymentId: prior.paymentId, replayed: true };
      }
    }
    throw e;
  }
}

/**
 * Cancel a booking. Inside the free-cancellation window the charge is reversed (club
 * account) or refunded (Pay Now); afterwards the accepted terms on the booking apply.
 */
export async function cancelBooking(actor: Actor, bookingId: string, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const staff = can(actor, "schedule.manage");
  const outcome = await db.transaction(async (tx) => {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for("update");
    if (!b || (!staff && !actor.householdIds.includes(b.householdId))) throw new NotFoundError("Booking");
    if (!staff) {
      if (b.personId !== actor.personId && b.bookedByPersonId !== actor.personId) await authoriseBookingFor(tx, actor, b.personId);
    }
    if (b.status !== "confirmed" && b.status !== "pending_payment") throw new ConflictError("This booking can no longer be cancelled.");
    const [s] = b.sessionId ? await tx.select().from(sessions).where(eq(sessions.id, b.sessionId)) : [];
    const startsAt = s?.startsAt ?? now;
    const free = staff || b.status === "pending_payment" || startsAt.getTime() - now.getTime() >= b.terms.cancelWindowHours * 3600 * 1000;

    await tx.update(bookings).set({ status: "cancelled", cancelledAt: now, cancelReason: free ? "cancelled" : "late_cancel", updatedAt: now }).where(eq(bookings.id, b.id));
    await tx.delete(resourceReservations).where(eq(resourceReservations.bookingId, b.id));

    let refund: { paymentId: string; amountCents: number } | null = null;
    if (b.status === "confirmed") {
      if (free && b.priceCents > 0) {
        const [charge] = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, `booking:${b.id}:charge`));
        if (charge) await reverseEntry(tx, charge.id, "booking cancelled", actor.userId);
        if (b.paymentMethod === "pay_now" && b.paymentId) refund = { paymentId: b.paymentId, amountCents: b.priceCents };
      } else if (!free && b.priceCents === 0 && b.terms.lateCancelFeeCents > 0) {
        const [acct] = await tx.select().from(billingAccounts).where(eq(billingAccounts.householdId, b.householdId));
        await postEntry(tx, {
          billingAccountId: acct!.id,
          entryType: "charge",
          amountCents: b.terms.lateCancelFeeCents,
          currency: b.currency,
          description: "Late cancellation fee",
          category: "late_cancel_fee",
          personId: b.personId,
          sourceType: "booking",
          sourceId: b.id,
          idempotencyKey: `booking:${b.id}:late-fee`,
        });
      }
    }
    await audit(tx, { actorUserId: actor.userId, action: "booking.cancelled", entityType: "booking", entityId: b.id, householdId: b.householdId, data: { free, refund: Boolean(refund) } });
    return { free, refund, paymentId: b.paymentId, wasPending: b.status === "pending_payment" };
  });
  // Provider calls happen after commit so a slow processor never holds database locks.
  if (outcome.refund) await refundPaymentInternal(outcome.refund.paymentId, outcome.refund.amountCents, "booking cancelled", { actorUserId: actor.userId });
  return { free: outcome.free, refunded: Boolean(outcome.refund) };
}

/** Bookings visible to a member: only their own household's. */
export async function listHouseholdBookings(actor: Actor, opts: { upcoming?: boolean; limit?: number } = {}) {
  if (actor.householdIds.length === 0) return [];
  return db
    .select({
      booking: bookings,
      serviceName: services.name,
      startsAt: sessions.startsAt,
      endsAt: sessions.endsAt,
      location: sql<string | null>`coalesce(${sessions.location}, ${resources.name})`,
      participantFirst: persons.firstName,
      participantLast: persons.lastName,
    })
    .from(bookings)
    .innerJoin(services, eq(services.id, bookings.serviceId))
    .innerJoin(persons, eq(persons.id, bookings.personId))
    .leftJoin(sessions, eq(sessions.id, bookings.sessionId))
    .leftJoin(resources, eq(resources.id, sessions.resourceId))
    .where(
      and(
        inArray(bookings.householdId, actor.householdIds),
        opts.upcoming ? and(gte(sessions.startsAt, new Date()), inArray(bookings.status, ["confirmed", "pending_payment"])) : undefined,
      ),
    )
    .orderBy(opts.upcoming ? asc(sessions.startsAt) : desc(sessions.startsAt))
    .limit(opts.limit ?? 50);
}

/* ---------------------- Resources and staff scheduling -------------------- */

export const createSessionSchema = z.object({
  serviceId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  capacity: z.number().int().min(1).max(500).optional(),
  coachUserId: z.string().optional(),
  resourceId: z.string().uuid().optional(),
  location: z.string().trim().max(120).optional(),
  /** Repeat weekly for this many additional weeks (same club-local time across DST changes). */
  repeatWeeks: z.number().int().min(0).max(26).default(0),
});

async function insertSession(tx: Tx, service: Service, v: { startsAt: Date; capacity?: number; coachUserId?: string; resourceId?: string; location?: string }) {
  const endsAt = new Date(v.startsAt.getTime() + service.durationMinutes * 60 * 1000);
  const [s] = await tx
    .insert(sessions)
    .values({ serviceId: service.id, startsAt: v.startsAt, endsAt, capacity: v.capacity ?? service.defaultCapacity, coachUserId: v.coachUserId ?? null, resourceId: v.resourceId ?? null, location: v.location ?? null })
    .returning();
  if (v.resourceId) await tx.insert(resourceReservations).values({ resourceId: v.resourceId, startsAt: v.startsAt, endsAt, kind: "session", sessionId: s!.id });
  return s!;
}

/** Create one session or a weekly series. A resource clash rejects the whole request. */
export async function createSessions(actor: Actor, raw: z.input<typeof createSessionSchema>) {
  assertCan(actor, "schedule.manage");
  const input = createSessionSchema.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const [service] = await tx.select().from(services).where(eq(services.id, input.serviceId));
      if (!service) throw new NotFoundError("Service");
      const created: Session[] = [];
      for (let w = 0; w <= input.repeatWeeks; w++) {
        const startsAt = clubTimeToUtc(addDays(input.date, 7 * w), input.time);
        created.push(await insertSession(tx, service, { ...input, startsAt }));
      }
      await audit(tx, { actorUserId: actor.userId, action: "session.created", entityType: "service", entityId: service.id, data: { count: created.length, first: created[0]!.startsAt.toISOString() } });
      return created;
    });
  } catch (e) {
    if (pgErrorCode(e) === PG_EXCLUSION_VIOLATION) throw new ConflictError("The selected room or resource is already in use at that time.", "resource_conflict");
    throw e;
  }
}

/** Seed/test helper: weekly sessions on given weekdays without an actor. */
export async function generateWeeklySessions(tx: Tx, service: Service, opts: { fromDate: string; days: number; weekdays: number[]; time: string; coachUserId?: string; resourceId?: string; location?: string; capacity?: number }) {
  const out: Session[] = [];
  for (let d = 0; d < opts.days; d++) {
    const date = addDays(opts.fromDate, d);
    if (!opts.weekdays.includes(weekdayOf(date))) continue;
    out.push(await insertSession(tx, service, { ...opts, startsAt: clubTimeToUtc(date, opts.time) }));
  }
  return out;
}

/** Block a resource (maintenance, private event). Fails if anything already claims the time. */
export async function blockResource(actor: Actor, input: { resourceId: string; startsAt: Date; endsAt: Date; note: string }) {
  assertCan(actor, "schedule.manage");
  try {
    const [r] = await db.insert(resourceReservations).values({ ...input, kind: "maintenance" }).returning();
    await audit(db, { actorUserId: actor.userId, action: "resource.blocked", entityType: "resource", entityId: input.resourceId, data: { startsAt: input.startsAt.toISOString(), endsAt: input.endsAt.toISOString() } });
    return r!;
  } catch (e) {
    if (pgErrorCode(e) === PG_EXCLUSION_VIOLATION) throw new ConflictError("That resource is already reserved during this time.", "resource_conflict");
    throw e;
  }
}

/**
 * Low-level exclusive claim on a resource for a booking. The database exclusion constraint
 * is the arbiter, so two simultaneous requests for the same slot cannot both succeed.
 * (The member-facing court/golf slot picker is Milestone 2.)
 */
export async function claimResource(tx: Tx, input: { resourceId: string; startsAt: Date; endsAt: Date; bookingId?: string; sessionId?: string; kind: "booking" | "session" | "maintenance" }) {
  try {
    // Savepoint so a clash does not abort the caller's transaction.
    return await tx.transaction(async (sp) => {
      const [r] = await sp.insert(resourceReservations).values(input).returning();
      return r!;
    });
  } catch (e) {
    if (pgErrorCode(e) === PG_EXCLUSION_VIOLATION) throw new ConflictError("That time is no longer available.", "slot_taken");
    throw e;
  }
}

export async function cancelSession(actor: Actor, sessionId: string) {
  assertCan(actor, "schedule.manage");
  const affected = await db.transaction(async (tx) => {
    const [s] = await tx.select().from(sessions).where(eq(sessions.id, sessionId)).for("update");
    if (!s) throw new NotFoundError("Session");
    if (s.status === "cancelled") return [];
    await tx.update(sessions).set({ status: "cancelled" }).where(eq(sessions.id, s.id));
    await tx.delete(resourceReservations).where(eq(resourceReservations.sessionId, s.id));
    await audit(tx, { actorUserId: actor.userId, action: "session.cancelled", entityType: "session", entityId: s.id });
    return tx.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.sessionId, s.id), inArray(bookings.status, ["confirmed", "pending_payment"])));
  });
  // Club-initiated cancellation is always free for the member.
  for (const b of affected) await cancelBooking(actor, b.id);
  return { cancelledBookings: affected.length };
}

export async function sessionRoster(actor: Actor, sessionId: string) {
  assertCan(actor, "schedule.view");
  const [row] = await db.select({ session: sessions, service: services, coachName: user.name }).from(sessions).innerJoin(services, eq(services.id, sessions.serviceId)).leftJoin(user, eq(user.id, sessions.coachUserId)).where(eq(sessions.id, sessionId));
  if (!row) throw new NotFoundError("Session");
  // Coaches without a broader role only see rosters for sessions they lead.
  if (actor.roles.every((r) => r === "coach") && row.session.coachUserId !== actor.userId) throw new ForbiddenError();
  const roster = await db
    .select({ bookingId: bookings.id, status: bookings.status, firstName: persons.firstName, lastName: persons.lastName, memberNumber: persons.memberNumber, paymentMethod: bookings.paymentMethod })
    .from(bookings)
    .innerJoin(persons, eq(persons.id, bookings.personId))
    .where(and(eq(bookings.sessionId, sessionId), inArray(bookings.status, ["confirmed", "pending_payment", "attended", "no_show"])))
    .orderBy(asc(persons.lastName));
  return { ...row, roster };
}

export async function markAttendance(actor: Actor, bookingId: string, status: "attended" | "no_show") {
  assertCan(actor, "schedule.view");
  await db.transaction(async (tx) => {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for("update");
    if (!b) throw new NotFoundError("Booking");
    if (!["confirmed", "attended", "no_show"].includes(b.status)) throw new ConflictError("Only confirmed bookings can be marked.");
    if (b.sessionId && actor.roles.every((r) => r === "coach")) {
      const [s] = await tx.select().from(sessions).where(eq(sessions.id, b.sessionId));
      if (s?.coachUserId !== actor.userId) throw new ForbiddenError();
    }
    await tx.update(bookings).set({ status, updatedAt: new Date() }).where(eq(bookings.id, b.id));
    if (status === "no_show" && b.terms.noShowFeeCents > 0) {
      const [acct] = await tx.select().from(billingAccounts).where(eq(billingAccounts.householdId, b.householdId));
      await postEntry(tx, {
        billingAccountId: acct!.id,
        entryType: "charge",
        amountCents: b.terms.noShowFeeCents,
        currency: b.currency,
        description: "No-show fee",
        category: "no_show_fee",
        personId: b.personId,
        sourceType: "booking",
        sourceId: b.id,
        idempotencyKey: `booking:${b.id}:no-show`,
        createdByUserId: actor.userId,
      });
    }
    await audit(tx, { actorUserId: actor.userId, action: `booking.${status}`, entityType: "booking", entityId: b.id, householdId: b.householdId });
  });
}

/** Job: release unpaid holds whose time has run out. */
export async function expireLapsedHolds() {
  const rows = await db
    .update(bookings)
    .set({ status: "expired", cancelReason: "hold_expired", updatedAt: new Date() })
    .where(and(eq(bookings.status, "pending_payment"), sql`${bookings.holdExpiresAt} <= now()`))
    .returning({ id: bookings.id });
  return rows.length;
}
