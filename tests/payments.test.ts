import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { bookings, ledgerEntries, payments, sandboxCheckouts, webhookEvents } from "@/db/schema";
import { getBalance, postEntry, reverseEntry } from "@/modules/billing/ledger";
import { createPayment, reconcileOpenPayments, refundPaymentInternal, startCheckout, syncPaymentFromProvider } from "@/modules/billing/payments";
import { handlePaymentWebhook } from "@/modules/billing/webhooks";
import { bookSession } from "@/modules/booking/engine";
import { bookArgs, ensureBase, makeHousehold, makeSession, openCheckout, sandbox, uid } from "./helpers";

beforeAll(ensureBase);

const getPayment = async (id: string) => (await db.select().from(payments).where(eq(payments.id, id)))[0]!;
const getBooking = async (id: string) => (await db.select().from(bookings).where(eq(bookings.id, id)))[0]!;
const ledger = (acct: string) => db.select().from(ledgerEntries).where(eq(ledgerEntries.billingAccountId, acct));

async function payNowBooking(opts: { capacity?: number } = {}) {
  const { session } = await makeSession({ priceCents: 3000, capacity: opts.capacity ?? 5 });
  const h = await makeHousehold();
  const r = await bookSession(h.actor, bookArgs(h, session.id, 3000, "pay_now"));
  const checkoutId = await openCheckout(r.paymentId!);
  const [co] = await db.select().from(sandboxCheckouts).where(eq(sandboxCheckouts.id, checkoutId));
  return { h, session, bookingId: r.booking.id, paymentId: r.paymentId!, checkoutId, co: co! };
}

const send = (event: object) => {
  const body = JSON.stringify(event);
  return handlePaymentWebhook(sandbox(), body, sandbox().sign(body));
};

describe("charge-producing requests are idempotent", () => {
  it("maps a retried payment request to one payment and one provider checkout", async () => {
    const h = await makeHousehold();
    const args = { billingAccountId: h.billingAccountId, purpose: "account_payment" as const, currency: "usd", lineItems: [{ description: "Balance", amountCents: 1234, category: "payment" }], idempotencyKey: uid() };
    const created = await Promise.all(Array.from({ length: 5 }, () => createPayment(db, args)));
    expect(new Set(created.map((p) => p.id)).size).toBe(1);
    const urls = await Promise.all(Array.from({ length: 4 }, () => startCheckout(created[0]!.id, { successPath: "/a", cancelPath: "/b" })));
    expect(new Set(urls.map((u) => u.url)).size).toBe(1);
    expect(await db.select().from(sandboxCheckouts).where(eq(sandboxCheckouts.paymentId, created[0]!.id))).toHaveLength(1);
  });

  it("refuses to reuse an idempotency key for a different account", async () => {
    const [a, b] = await Promise.all([makeHousehold(), makeHousehold()]);
    const key = uid();
    const li = [{ description: "x", amountCents: 100, category: "payment" }];
    await createPayment(db, { billingAccountId: a.billingAccountId, purpose: "account_payment", currency: "usd", lineItems: li, idempotencyKey: key });
    await expect(createPayment(db, { billingAccountId: b.billingAccountId, purpose: "account_payment", currency: "usd", lineItems: li, idempotencyKey: key })).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("webhooks", () => {
  it("rejects events with a missing or invalid signature and stores nothing", async () => {
    const t = await payNowBooking();
    const body = JSON.stringify(sandbox().buildEvent("checkout.session.completed", sandbox().sessionObject(t.co, "paid")));
    await expect(handlePaymentWebhook(sandbox(), body, null)).rejects.toMatchObject({ code: "invalid_signature" });
    await expect(handlePaymentWebhook(sandbox(), body, "t=1,v1=deadbeef")).rejects.toMatchObject({ code: "invalid_signature" });
    // A valid signature over a different body does not verify a tampered payload.
    await expect(handlePaymentWebhook(sandbox(), body.replace("paid", "paid "), sandbox().sign(body))).rejects.toMatchObject({ code: "invalid_signature" });
    expect((await getPayment(t.paymentId)).status).toBe("pending");
    expect(await ledger(t.h.billingAccountId)).toHaveLength(0);
  });

  it("applies a repeated success event exactly once, even when delivered concurrently", async () => {
    const t = await payNowBooking();
    const event = sandbox().buildEvent("checkout.session.completed", sandbox().sessionObject(t.co, "paid"));
    const results = await Promise.all(Array.from({ length: 8 }, () => send(event)));
    expect(results.some((r) => r.outcome === "processed")).toBe(true);
    expect((await send(event)).outcome).toBe("duplicate");
    // A different event id carrying the same fact is also harmless.
    await send(sandbox().buildEvent("checkout.session.async_payment_succeeded", sandbox().sessionObject(t.co, "paid")));
    const entries = await ledger(t.h.billingAccountId);
    expect(entries.map((e) => [e.entryType, e.amountCents]).sort()).toEqual([["charge", 3000], ["payment", -3000]].sort());
    expect(await getBalance(db, t.h.billingAccountId)).toBe(0);
    expect((await getBooking(t.bookingId)).status).toBe("confirmed");
    expect(await db.select().from(webhookEvents).where(eq(webhookEvents.eventId, (event as { id: string }).id))).toHaveLength(1);
  });

  it("ignores stale failure/cancel events that arrive after success", async () => {
    const t = await payNowBooking();
    await send(sandbox().buildEvent("checkout.session.completed", sandbox().sessionObject(t.co, "paid")));
    await send(sandbox().buildEvent("checkout.session.expired", sandbox().sessionObject(t.co, "unpaid")));
    await send(sandbox().buildEvent("checkout.session.async_payment_failed", sandbox().sessionObject(t.co, "unpaid")));
    expect((await getPayment(t.paymentId)).status).toBe("succeeded");
    expect((await getBooking(t.bookingId)).status).toBe("confirmed");
  });

  it("handles a refund event that arrives before the success event", async () => {
    const t = await payNowBooking();
    const refund = (total: number) => sandbox().buildEvent("charge.refunded", { id: "ch_x", object: "charge", payment_intent: t.co.paymentIntentId, amount: 3000, amount_refunded: total, metadata: { aac_payment_id: t.paymentId } });
    await send(refund(1000));
    expect(await getPayment(t.paymentId)).toMatchObject({ status: "partially_refunded", refundedCents: 1000 });
    await send(sandbox().buildEvent("checkout.session.completed", sandbox().sessionObject(t.co, "paid"))); // late success: no second posting
    await send(refund(1000)); // same cumulative total again: no-op
    await send(refund(3000));
    expect(await getPayment(t.paymentId)).toMatchObject({ status: "refunded", refundedCents: 3000 });
    const entries = (await ledger(t.h.billingAccountId)).map((e) => [e.entryType, e.amountCents]).sort();
    expect(entries).toEqual([["charge", 3000], ["payment", -3000], ["refund", 1000], ["refund", 2000]].sort());
  });

  it("records unrelated or unknown events without acting on them", async () => {
    expect((await send(sandbox().buildEvent("customer.created", { id: "cus_1", object: "customer" }))).outcome).toBe("ignored");
    const orphan = { id: "cs_unknown", object: "checkout.session", payment_status: "paid", payment_intent: "pi_unknown", metadata: {} };
    expect((await send(sandbox().buildEvent("checkout.session.completed", orphan))).outcome).toBe("ignored");
  });
});

describe("payment outcomes leave consistent records", () => {
  it("pending: holds the seat, posts nothing", async () => {
    const t = await payNowBooking({ capacity: 1 });
    expect(await getBooking(t.bookingId)).toMatchObject({ status: "pending_payment", paymentMethod: "pay_now" });
    expect(await ledger(t.h.billingAccountId)).toHaveLength(0);
    const other = await makeHousehold();
    await expect(bookSession(other.actor, bookArgs(other, t.session.id, 3000, "pay_now"))).rejects.toMatchObject({ code: "session_full" });
  });

  it("declined attempt: stays open for retry; later success confirms once", async () => {
    const t = await payNowBooking();
    await sandbox().simulate(t.checkoutId, "decline");
    expect(await getPayment(t.paymentId)).toMatchObject({ status: "pending", failureReason: "card_declined" });
    expect((await getBooking(t.bookingId)).status).toBe("pending_payment");
    await sandbox().simulate(t.checkoutId, "success");
    expect(await getPayment(t.paymentId)).toMatchObject({ status: "succeeded", failureReason: null });
  });

  it("canceled: releases the seat and posts nothing", async () => {
    const t = await payNowBooking({ capacity: 1 });
    await sandbox().simulate(t.checkoutId, "cancel");
    expect((await getPayment(t.paymentId)).status).toBe("canceled");
    expect(await getBooking(t.bookingId)).toMatchObject({ status: "expired", cancelReason: "payment_canceled" });
    expect(await ledger(t.h.billingAccountId)).toHaveLength(0);
    const other = await makeHousehold();
    await expect(bookSession(other.actor, bookArgs(other, t.session.id, 3000, "pay_now"))).resolves.toBeTruthy();
  });

  it("delayed method: processing keeps the seat; failure releases it without ledger entries", async () => {
    const t = await payNowBooking({ capacity: 1 });
    await sandbox().simulate(t.checkoutId, "delayed");
    expect((await getPayment(t.paymentId)).status).toBe("processing");
    expect(await getBooking(t.bookingId)).toMatchObject({ status: "pending_payment", holdExpiresAt: null });
    expect(await ledger(t.h.billingAccountId)).toHaveLength(0);
    await sandbox().simulate(t.checkoutId, "delayed_failure");
    expect((await getPayment(t.paymentId)).status).toBe("failed");
    expect((await getBooking(t.bookingId)).status).toBe("expired");
    expect(await ledger(t.h.billingAccountId)).toHaveLength(0);
  });

  it("delayed method: later success confirms and balances", async () => {
    const t = await payNowBooking();
    await sandbox().simulate(t.checkoutId, "delayed");
    await sandbox().simulate(t.checkoutId, "delayed_success");
    expect((await getPayment(t.paymentId)).status).toBe("succeeded");
    expect((await getBooking(t.bookingId)).status).toBe("confirmed");
    expect(await getBalance(db, t.h.billingAccountId)).toBe(0);
  });

  it("payment that lands after the hold lapsed and the class filled becomes account credit, not a double-booked seat", async () => {
    const t = await payNowBooking({ capacity: 1 });
    await db.update(bookings).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(eq(bookings.id, t.bookingId));
    const other = await makeHousehold();
    await bookSession(other.actor, bookArgs(other, t.session.id, 3000, "pay_now")); // takes the released seat
    await sandbox().simulate(t.checkoutId, "success");
    expect((await getPayment(t.paymentId)).status).toBe("succeeded");
    expect((await getBooking(t.bookingId)).status).toBe("expired");
    expect(await getBalance(db, t.h.billingAccountId)).toBe(-3000); // credit held for the member
    const live = await db.select().from(bookings).where(and(eq(bookings.sessionId, t.session.id), eq(bookings.status, "confirmed")));
    expect(live.length).toBeLessThanOrEqual(1);
  });

  it("staff refund: partial then full, never more than was paid, one provider refund per request", async () => {
    const t = await payNowBooking();
    await sandbox().simulate(t.checkoutId, "success");
    await Promise.allSettled([refundPaymentInternal(t.paymentId, 1000, "goodwill", { creditCharge: true }), refundPaymentInternal(t.paymentId, 1000, "goodwill", { creditCharge: true })]);
    expect(await getPayment(t.paymentId)).toMatchObject({ status: "partially_refunded", refundedCents: 1000 });
    await expect(refundPaymentInternal(t.paymentId, 2500, "too much")).rejects.toMatchObject({ code: "validation_error" });
    await refundPaymentInternal(t.paymentId, 2000, "rest", { creditCharge: true });
    expect(await getPayment(t.paymentId)).toMatchObject({ status: "refunded", refundedCents: 3000 });
    expect(await getBalance(db, t.h.billingAccountId)).toBe(0);
    await expect(refundPaymentInternal(t.paymentId, 1, "again")).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("trusted provider state and reconciliation", () => {
  it("confirms payment from the provider, not the browser redirect, when the webhook is missed", async () => {
    const t = await payNowBooking();
    // Customer paid, but the webhook never arrived.
    await db.update(sandboxCheckouts).set({ status: "complete", paymentStatus: "paid" }).where(eq(sandboxCheckouts.id, t.checkoutId));
    expect((await getPayment(t.paymentId)).status).toBe("pending");
    const synced = await syncPaymentFromProvider(t.paymentId);
    expect(synced.status).toBe("succeeded");
    expect((await getBooking(t.bookingId)).status).toBe("confirmed");
    // A customer who merely visits the success URL without paying gains nothing.
    const u = await payNowBooking();
    expect((await syncPaymentFromProvider(u.paymentId)).status).toBe("pending");
    expect((await getBooking(u.bookingId)).status).toBe("pending_payment");
  });

  it("reconciliation settles stragglers and matches the ledger", async () => {
    const t = await payNowBooking();
    await db.update(sandboxCheckouts).set({ status: "complete", paymentStatus: "paid" }).where(eq(sandboxCheckouts.id, t.checkoutId));
    await db.update(payments).set({ updatedAt: new Date(Date.now() - 10 * 60000) }).where(eq(payments.id, t.paymentId));
    const r = await reconcileOpenPayments();
    expect(r.errors).toBe(0);
    expect((await getPayment(t.paymentId)).status).toBe("succeeded");
    expect(await getBalance(db, t.h.billingAccountId)).toBe(0);
  });
});

describe("ledger integrity", () => {
  it("makes posted entries immutable and reversible exactly once", async () => {
    const h = await makeHousehold();
    const { entry } = await postEntry(db, { billingAccountId: h.billingAccountId, entryType: "charge", amountCents: 1500, currency: "usd", description: "Guest fee", category: "guest", idempotencyKey: uid() });
    await expect(db.update(ledgerEntries).set({ amountCents: 1 }).where(eq(ledgerEntries.id, entry.id))).rejects.toThrow();
    await expect(db.delete(ledgerEntries).where(eq(ledgerEntries.id, entry.id))).rejects.toThrow();
    await reverseEntry(db, entry.id, "entered in error", null);
    const second = await reverseEntry(db, entry.id, "again", null);
    expect(second.created).toBe(false);
    expect(await getBalance(db, h.billingAccountId)).toBe(0);
    expect(await ledger(h.billingAccountId)).toHaveLength(2);
  });

  it("posts a business event once per idempotency key and validates signs", async () => {
    const h = await makeHousehold();
    const key = uid();
    const base = { billingAccountId: h.billingAccountId, entryType: "charge" as const, amountCents: 700, currency: "usd", description: "Towel", category: "retail", idempotencyKey: key };
    const posted = await Promise.all(Array.from({ length: 6 }, () => postEntry(db, base)));
    expect(posted.filter((p) => p.created)).toHaveLength(1);
    expect(await getBalance(db, h.billingAccountId)).toBe(700);
    await expect(postEntry(db, { ...base, idempotencyKey: uid(), amountCents: -700 })).rejects.toMatchObject({ code: "validation_error" });
    await expect(postEntry(db, { ...base, idempotencyKey: uid(), amountCents: 10.5 })).rejects.toMatchObject({ code: "validation_error" });
  });
});
