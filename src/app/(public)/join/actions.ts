"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { actionError, type ActionState } from "@/lib/action";
import { reportError } from "@/lib/log";
import { startCheckout } from "@/modules/billing/payments";
import { enroll } from "@/modules/membership/enrollment";

export async function enrollAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let destination: string;
  try {
    const s = (k: string) => String(form.get(k) ?? "");
    let additionalMembers: unknown = [];
    try {
      additionalMembers = JSON.parse(s("additionalMembers") || "[]");
    } catch {
      return { ok: false, error: "Household members could not be read. Please re-enter them." };
    }
    const h = await headers();
    const result = await enroll(
      {
        planCode: s("planCode"),
        primary: { firstName: s("firstName"), lastName: s("lastName"), email: s("email"), phone: s("phone"), dateOfBirth: s("dateOfBirth"), password: s("password") },
        additionalMembers: additionalMembers as never,
        acceptAgreement: (form.get("acceptAgreement") === "on") as true,
        acceptWaiver: (form.get("acceptWaiver") === "on") as true,
        marketingEmailOptIn: form.get("marketingEmailOptIn") === "on",
        marketingSmsOptIn: form.get("marketingSmsOptIn") === "on",
        idempotencyKey: s("idempotencyKey"),
      },
      { ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null },
    );
    // Sign the new member in so the payment page and portal are scoped to their household.
    await auth.api.signInEmail({ body: { email: s("email"), password: s("password") }, headers: h });
    destination = "/portal";
    if (result.paymentId) {
      destination = `/portal/payment/${result.paymentId}`;
      try {
        const { url } = await startCheckout(result.paymentId, { successPath: destination, cancelPath: destination, customerEmail: s("email"), savePaymentMethod: true });
        if (url) destination = url;
      } catch (e) {
        // The enrollment is saved; the member can resume payment from the payment page.
        reportError("enroll.checkout_start_failed", e, { paymentId: result.paymentId });
      }
    }
  } catch (e) {
    return actionError(e);
  }
  redirect(destination);
}
