"use server";

import { redirect } from "next/navigation";
import { actionError, type ActionState } from "@/lib/action";
import { reportError } from "@/lib/log";
import { requireActor } from "@/lib/session";
import { startCheckout } from "@/modules/billing/payments";
import { bookSession, cancelBooking } from "@/modules/booking/engine";

export async function bookAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let destination = "/portal/schedule?notice=booked";
  try {
    const actor = await requireActor();
    const result = await bookSession(actor, {
      sessionId: String(form.get("sessionId")),
      participantPersonId: String(form.get("participantPersonId")),
      paymentMethod: String(form.get("paymentMethod")) as "included",
      acceptedPolicyVersion: Number(form.get("acceptedPolicyVersion")),
      acceptedPriceCents: Number(form.get("acceptedPriceCents")),
      idempotencyKey: String(form.get("idempotencyKey")),
    });
    if (result.paymentId && result.booking.status === "pending_payment") {
      destination = `/portal/payment/${result.paymentId}`;
      try {
        const { url } = await startCheckout(result.paymentId, { successPath: destination, cancelPath: destination });
        if (url) destination = url;
      } catch (e) {
        reportError("booking.checkout_start_failed", e, { paymentId: result.paymentId });
      }
    }
  } catch (e) {
    return actionError(e);
  }
  redirect(destination);
}

export async function cancelBookingAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await requireActor();
    const r = await cancelBooking(actor, String(form.get("bookingId")));
    return { ok: true, message: r.refunded ? "Booking cancelled. Your refund is on its way to the original payment method." : r.free ? "Booking cancelled." : "Booking cancelled. This was inside the cancellation window, so it is not refundable." };
  } catch (e) {
    return actionError(e);
  }
}
