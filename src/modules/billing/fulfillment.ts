import type { Tx } from "@/db";
import type { payments } from "@/db/schema";
import { confirmBookingFromPayment, releaseBookingForPayment, holdBookingWhileProcessing } from "@/modules/booking/fulfillment";
import { activateMembershipFromPayment } from "@/modules/membership/activation";

type Payment = typeof payments.$inferSelect;

/**
 * Deliver what a settled payment paid for. Returns false when the purchase can no longer be
 * fulfilled (e.g. the seat hold lapsed and the class is now full); the payment then remains
 * on the ledger as account credit for staff to resolve, and is audited as unfulfilled.
 */
export async function fulfillPayment(tx: Tx, p: Payment): Promise<boolean> {
  switch (p.purpose) {
    case "enrollment":
      return activateMembershipFromPayment(tx, p);
    case "booking":
      return confirmBookingFromPayment(tx, p);
    case "account_payment":
      return true;
    default:
      return false;
  }
}

/** Undo reservations made in anticipation of a payment that failed or was abandoned. */
export async function releasePayment(tx: Tx, p: Payment, reason: "failed" | "canceled") {
  if (p.purpose === "booking") await releaseBookingForPayment(tx, p, reason);
  // Enrollment: the membership stays `pending_payment` so the member can retry.
}

export async function onPaymentProcessing(tx: Tx, p: Payment) {
  if (p.purpose === "booking") await holdBookingWhileProcessing(tx, p);
}
