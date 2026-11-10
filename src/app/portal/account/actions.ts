"use server";

import { redirect } from "next/navigation";
import { actionError, type ActionState } from "@/lib/action";
import { requireActor } from "@/lib/session";
import { createBalancePayment } from "@/modules/billing/account";
import { startCheckout } from "@/modules/billing/payments";
import { retryEnrollmentPayment } from "@/modules/membership/enrollment";

async function toCheckout(paymentId: string): Promise<string> {
  const page = `/portal/payment/${paymentId}`;
  const { url } = await startCheckout(paymentId, { successPath: page, cancelPath: page });
  return url ?? page;
}

export async function payBalanceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let destination: string;
  try {
    const actor = await requireActor();
    const p = await createBalancePayment(actor, String(form.get("householdId")), String(form.get("idempotencyKey")));
    destination = await toCheckout(p.id);
  } catch (e) {
    return actionError(e);
  }
  redirect(destination);
}

export async function retryEnrollmentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let destination: string;
  try {
    const actor = await requireActor();
    const p = await retryEnrollmentPayment(actor.userId, String(form.get("membershipId")), actor.householdIds);
    destination = await toCheckout(p.id);
  } catch (e) {
    return actionError(e);
  }
  redirect(destination);
}

export async function resumeCheckoutAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let destination: string;
  try {
    const actor = await requireActor();
    const { getPaymentForActor } = await import("@/modules/billing/account");
    const p = await getPaymentForActor(actor, String(form.get("paymentId")));
    destination = await toCheckout(p.id);
  } catch (e) {
    return actionError(e);
  }
  redirect(destination);
}
