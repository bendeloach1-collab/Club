"use server";

import { actionError, type ActionState } from "@/lib/action";
import { formatClubDateTime } from "@/lib/time";
import { captureLead, scheduleTour } from "@/modules/crm/leads";

function leadFields(form: FormData) {
  const s = (k: string) => String(form.get(k) ?? "").trim();
  return {
    firstName: s("firstName"),
    lastName: s("lastName"),
    email: s("email"),
    phone: s("phone"),
    interest: s("interest") || undefined,
    message: s("message") || undefined,
    source: s("source") || "website",
    utmSource: s("utm_source") || undefined,
    utmMedium: s("utm_medium") || undefined,
    utmCampaign: s("utm_campaign") || undefined,
    marketingEmailOptIn: form.get("marketingEmailOptIn") === "on",
    marketingSmsOptIn: form.get("marketingSmsOptIn") === "on",
  };
}

// A filled honeypot field means an automated submission: accept silently, store nothing.
const isBot = (form: FormData) => String(form.get("company") ?? "") !== "";

export async function inquireAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    if (!isBot(form)) await captureLead(leadFields(form));
    // The same message is shown whether or not we already know this contact.
    return { ok: true, message: "Thank you — a member of our team will be in touch within one business day." };
  } catch (e) {
    return actionError(e);
  }
}

export async function tourAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const at = new Date(String(form.get("scheduledAt") ?? ""));
    if (Number.isNaN(at.getTime())) return { ok: false, error: "Please choose a tour time." };
    if (!isBot(form)) await scheduleTour({ lead: leadFields(form), scheduledAt: at });
    return { ok: true, message: `Your tour is booked for ${formatClubDateTime(at)} (Eastern Time). We look forward to meeting you.` };
  } catch (e) {
    return actionError(e);
  }
}
