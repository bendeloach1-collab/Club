import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { bookings, ledgerEntries, payments, resources, services } from "@/db/schema";
import { getBalance } from "@/modules/billing/ledger";
import { blockResource, bookSession, cancelBooking, claimResource, createSessions, listSessions, quoteBooking } from "@/modules/booking/engine";
import { bookArgs, ensureBase, makeHousehold, makeSession, makeStaff, openCheckout, sandbox, tally, uid } from "./helpers";

beforeAll(ensureBase);

describe("capacity and double-booking under concurrency", () => {
  it("never exceeds session capacity when many members book at once", async () => {
    const { session } = await makeSession({ capacity: 3 });
    const households = await Promise.all(Array.from({ length: 12 }, () => makeHousehold()));
    const results = await Promise.allSettled(households.map((h) => bookSession(h.actor, bookArgs(h, session.id, 0, "included"))));
    const { ok, codes } = tally(results);
    expect(ok).toHaveLength(3);
    expect(codes).toHaveLength(9);
    expect(new Set(codes)).toEqual(new Set(["session_full"]));
    const rows = await db.select().from(bookings).where(and(eq(bookings.sessionId, session.id), eq(bookings.status, "confirmed")));
    expect(rows).toHaveLength(3);
    const [item] = (await listSessions({ from: new Date(), to: new Date(Date.now() + 5 * 86400000) })).filter((s) => s.sessionId === session.id);
    expect(item).toMatchObject({ booked: 3, spotsLeft: 0 });
  });

  it("books a person into a session only once, even with simultaneous different requests", async () => {
    const { session } = await makeSession({ capacity: 10 });
    const h = await makeHousehold();
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => bookSession(h.actor, bookArgs(h, session.id, 0, "included"))));
    const { ok, codes } = tally(results);
    expect(ok).toHaveLength(1);
    expect(new Set(codes)).toEqual(new Set(["already_booked"]));
  });

  it("treats a retried request (same idempotency key) as the same booking", async () => {
    const { session } = await makeSession({ capacity: 10 });
    const h = await makeHousehold();
    const args = bookArgs(h, session.id, 0, "included");
    const results = await Promise.all(Array.from({ length: 5 }, () => bookSession(h.actor, args)));
    expect(new Set(results.map((r) => r.booking.id)).size).toBe(1);
    expect(await db.select().from(bookings).where(eq(bookings.sessionId, session.id))).toHaveLength(1);
  });

  it("allows exactly one of many simultaneous claims on the same resource slot", async () => {
    const [court] = await db.insert(resources).values({ name: `Court ${uid().slice(0, 4)}`, type: "court" }).returning();
    const startsAt = new Date(Date.now() + 72 * 3600000);
    const endsAt = new Date(startsAt.getTime() + 3600000);
    const overlapping = (offsetMin: number) =>
      db.transaction((tx) => claimResource(tx, { resourceId: court!.id, startsAt: new Date(startsAt.getTime() + offsetMin * 60000), endsAt: new Date(endsAt.getTime() + offsetMin * 60000), kind: "booking" }));
    const { ok, codes } = tally(await Promise.allSettled([0, 0, 0, 15, 30, -30, 45, 0].map(overlapping)));
    expect(ok).toHaveLength(1);
    expect(new Set(codes)).toEqual(new Set(["slot_taken"]));
    // Back-to-back is allowed; maintenance blocks and class sessions obey the same constraint.
    await db.transaction((tx) => claimResource(tx, { resourceId: court!.id, startsAt: new Date(startsAt.getTime() + 2 * 3600000), endsAt: new Date(startsAt.getTime() + 3 * 3600000), kind: "booking" }));
    const manager = await makeStaff("manager");
    await expect(blockResource(manager, { resourceId: court!.id, startsAt, endsAt, note: "resurfacing" })).rejects.toMatchObject({ code: "resource_conflict" });
  });

  it("rejects a recurring class series that collides with an existing room booking", async () => {
    const manager = await makeStaff("manager");
    const [room] = await db.insert(resources).values({ name: `Room ${uid().slice(0, 4)}`, type: "studio" }).returning();
    const [svc] = await db.select().from(services).where(eq(services.slug, "yoga"));
    const created = await createSessions(manager, { serviceId: svc!.id, date: "2027-03-01", time: "06:00", resourceId: room!.id, repeatWeeks: 3 });
    expect(created).toHaveLength(4);
    await expect(createSessions(manager, { serviceId: svc!.id, date: "2027-03-15", time: "06:30", resourceId: room!.id })).rejects.toMatchObject({ code: "resource_conflict" });
  });
});

describe("club-account charging", () => {
  it("cannot be overspent by concurrent charges", async () => {
    const h = await makeHousehold({ chargeEnabled: true, creditLimitCents: 5000 });
    const sessions = await Promise.all(Array.from({ length: 6 }, () => makeSession({ priceCents: 2000 })));
    const results = await Promise.allSettled(sessions.map((s) => bookSession(h.actor, bookArgs(h, s.session.id, 2000, "club_account"))));
    const { ok, codes } = tally(results);
    expect(ok).toHaveLength(2); // 2 × $20 fits a $50 limit; a third would not
    expect(new Set(codes)).toEqual(new Set(["account_limit_exceeded"]));
    expect(await getBalance(db, h.billingAccountId)).toBe(4000);
    // Rejected charges leave no booking behind.
    expect(await db.select().from(bookings).where(eq(bookings.householdId, h.householdId))).toHaveLength(2);
  });

  it("requires explicit permission and an enabled, active account", async () => {
    const { session } = await makeSession({ priceCents: 1000 });
    const disabled = await makeHousehold({ chargeEnabled: false, creditLimitCents: 5000 });
    await expect(bookSession(disabled.actor, bookArgs(disabled, session.id, 1000, "club_account"))).rejects.toMatchObject({ code: "forbidden" });
    const q = await quoteBooking(disabled.actor, session.id, disabled.actor.personId);
    expect(q.paymentOptions).toEqual(["pay_now"]);
  });
});

describe("price, terms and eligibility", () => {
  it("stores the accepted price and policy with the booking and rejects stale terms", async () => {
    const { session, service } = await makeSession({ priceCents: 2500 });
    const h = await makeHousehold({ chargeEnabled: true, creditLimitCents: 100000 });
    const quote = await quoteBooking(h.actor, session.id, h.actor.personId);
    expect(quote.terms).toMatchObject({ priceCents: 2500, policyVersion: 1, cancelWindowHours: 12 });
    const { booking } = await bookSession(h.actor, bookArgs(h, session.id, 2500, "club_account"));
    // The club raises the price afterwards.
    await db.update(services).set({ memberPriceCents: 4000, policyVersion: 2 }).where(eq(services.id, service.id));
    const [stored] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(stored!.priceCents).toBe(2500);
    expect(stored!.terms).toMatchObject({ priceCents: 2500, policyVersion: 1 });
    expect(stored!.terms.summary).toContain("$25.00");
    // A member who was shown the old price cannot confirm at it.
    const other = await makeHousehold({ chargeEnabled: true, creditLimitCents: 100000 });
    await expect(bookSession(other.actor, bookArgs(other, session.id, 2500, "club_account"))).rejects.toMatchObject({ code: "terms_changed" });
  });

  it("requires an active membership, an open booking window and a native service", async () => {
    const { session } = await makeSession();
    const frozen = await makeHousehold({ status: "frozen" });
    await expect(bookSession(frozen.actor, bookArgs(frozen, session.id, 0, "included"))).rejects.toMatchObject({ code: "forbidden" });
    const h = await makeHousehold();
    const far = await makeSession({ startsInHours: 24 * 40 });
    await expect(bookSession(h.actor, bookArgs(h, far.session.id, 0, "included"))).rejects.toMatchObject({ code: "not_bookable" });
    const past = await makeSession({ startsInHours: -1 });
    await expect(bookSession(h.actor, bookArgs(h, past.session.id, 0, "included"))).rejects.toMatchObject({ code: "not_bookable" });
    const partner = await makeSession({ slug: "golf-simulator" });
    await expect(bookSession(h.actor, bookArgs(h, partner.session.id, 0, "included"))).rejects.toMatchObject({ code: "partner_managed" });
  });

  it("only lets adults with permission book for other household members", async () => {
    const { session } = await makeSession();
    const h = await makeHousehold();
    await expect(bookSession(h.actor, bookArgs(h, session.id, 0, "included", h.childId))).resolves.toBeTruthy();
    const { householdMembers } = await import("@/db/schema");
    await db.update(householdMembers).set({ canBookForHousehold: false }).where(eq(householdMembers.personId, h.actor.personId));
    await expect(bookSession(h.actor, bookArgs(h, session.id, 0, "included", h.adultId))).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("cancellation", () => {
  it("reverses a club-account charge inside the free window and frees the seat", async () => {
    const { session } = await makeSession({ priceCents: 2000, capacity: 1 });
    const h = await makeHousehold({ chargeEnabled: true, creditLimitCents: 10000 });
    const { booking } = await bookSession(h.actor, bookArgs(h, session.id, 2000, "club_account"));
    expect(await getBalance(db, h.billingAccountId)).toBe(2000);
    expect(await cancelBooking(h.actor, booking.id)).toMatchObject({ free: true });
    expect(await getBalance(db, h.billingAccountId)).toBe(0);
    const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.billingAccountId, h.billingAccountId));
    expect(entries.map((e) => e.entryType).sort()).toEqual(["charge", "reversal"]); // original preserved
    const other = await makeHousehold();
    await expect(bookSession(other.actor, bookArgs(other, session.id, 2000, "pay_now"))).resolves.toBeTruthy();
    await expect(cancelBooking(h.actor, booking.id)).rejects.toMatchObject({ code: "conflict" });
  });

  it("keeps the charge for a late cancellation, per the terms accepted at booking", async () => {
    const { session } = await makeSession({ priceCents: 2000, startsInHours: 3 });
    const h = await makeHousehold({ chargeEnabled: true, creditLimitCents: 10000 });
    const { booking } = await bookSession(h.actor, bookArgs(h, session.id, 2000, "club_account"));
    expect(await cancelBooking(h.actor, booking.id)).toMatchObject({ free: false, refunded: false });
    expect(await getBalance(db, h.billingAccountId)).toBe(2000);
  });

  it("refunds a Pay Now booking cancelled in time, leaving a zero balance and full history", async () => {
    const { session } = await makeSession({ priceCents: 2500 });
    const h = await makeHousehold();
    const r = await bookSession(h.actor, bookArgs(h, session.id, 2500, "pay_now"));
    expect(r.booking.status).toBe("pending_payment");
    await sandbox().simulate(await openCheckout(r.paymentId!), "success");
    expect(await cancelBooking(h.actor, r.booking.id)).toMatchObject({ free: true, refunded: true });
    const [p] = await db.select().from(payments).where(eq(payments.id, r.paymentId!));
    expect(p).toMatchObject({ status: "refunded", refundedCents: 2500 });
    const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.billingAccountId, h.billingAccountId));
    expect(entries.map((e) => [e.entryType, e.amountCents]).sort()).toEqual([["charge", 2500], ["payment", -2500], ["refund", 2500], ["reversal", -2500]].sort());
    expect(await getBalance(db, h.billingAccountId)).toBe(0);
  });
});
