import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { bookings, payments, sessions } from "@/db/schema";
import { postEntry } from "@/modules/billing/ledger";

type Payment = typeof payments.$inferSelect;

/** Bookings that occupy a seat. Unpaid holds count only until they lapse. */
export const liveBookingFilter = sql`(${bookings.status} in ('confirmed','attended') or (${bookings.status} = 'pending_payment' and (${bookings.holdExpiresAt} is null or ${bookings.holdExpiresAt} > now())))`;

export async function countLiveBookings(tx: Tx, sessionId: string, excludeBookingId?: string) {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(bookings)
    .where(and(eq(bookings.sessionId, sessionId), liveBookingFilter, excludeBookingId ? sql`${bookings.id} <> ${excludeBookingId}` : undefined));
  return r?.n ?? 0;
}

/**
 * Payment settled → confirm the booking it paid for. If the hold lapsed in the meantime the
 * seat is re-checked under the session lock; when the class has since filled, the booking is
 * not confirmed and the payment stays on the account as credit (returns false).
 */
export async function confirmBookingFromPayment(tx: Tx, p: Payment): Promise<boolean> {
  const [b] = await tx.select().from(bookings).where(eq(bookings.paymentId, p.id)).for("update");
  if (!b) return false;
  if (b.status === "confirmed" || b.status === "attended") return true;
  if (b.status !== "pending_payment" && b.status !== "expired") return false;
  if (b.sessionId) {
    const [s] = await tx.select().from(sessions).where(eq(sessions.id, b.sessionId)).for("update");
    if (!s || s.status !== "scheduled") return false;
    const holdLapsed = b.status === "expired" || (b.holdExpiresAt !== null && b.holdExpiresAt.getTime() <= Date.now());
    if (holdLapsed && (await countLiveBookings(tx, s.id, b.id)) >= s.capacity) return false;
  }
  await tx.update(bookings).set({ status: "confirmed", holdExpiresAt: null, updatedAt: new Date() }).where(eq(bookings.id, b.id));
  await postEntry(tx, {
    billingAccountId: p.billingAccountId,
    entryType: "charge",
    amountCents: b.priceCents,
    currency: b.currency,
    description: p.lineItems[0]?.description ?? "Booking",
    category: "booking",
    personId: b.personId,
    sourceType: "booking",
    sourceId: b.id,
    paymentId: p.id,
    idempotencyKey: `booking:${b.id}:charge`,
  });
  return true;
}

export async function releaseBookingForPayment(tx: Tx, p: Payment, reason: "failed" | "canceled") {
  await tx
    .update(bookings)
    .set({ status: "expired", cancelReason: `payment_${reason}`, updatedAt: new Date() })
    .where(and(eq(bookings.paymentId, p.id), inArray(bookings.status, ["pending_payment"])));
}

/** Delayed payment methods take days to settle: keep the seat until the processor decides. */
export async function holdBookingWhileProcessing(tx: Tx, p: Payment) {
  await tx.update(bookings).set({ holdExpiresAt: null, updatedAt: new Date() }).where(and(eq(bookings.paymentId, p.id), eq(bookings.status, "pending_payment")));
}
