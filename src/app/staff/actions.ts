"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionError, type ActionState } from "@/lib/action";
import { formatMoney } from "@/lib/money";
import { requireActor } from "@/lib/session";
import { clubTimeToUtc } from "@/lib/time";
import { retryFailedWebhook, updateAccountSettings } from "@/modules/billing/admin";
import { refundPayment } from "@/modules/billing/payments";
import { cancelSession, createSessions, markAttendance } from "@/modules/booking/engine";
import { addLeadActivity, addLeadTask, captureLead, completeLeadTask, setTourStatus, updateLead } from "@/modules/crm/leads";
import { verifyGuardianship } from "@/modules/identity/households";
import { checkInMember, scheduleMembershipChange } from "@/modules/membership/lifecycle";
import { savePartner } from "@/modules/partners/partners";

const s = (form: FormData, k: string) => String(form.get(k) ?? "").trim();
type Handler = (form: FormData, actor: Awaited<ReturnType<typeof requireActor>>) => Promise<string | void>;

/** Every staff action resolves the actor from the session and delegates to a module that authorises it. */
function staffAction(handler: Handler, revalidate?: string) {
  return async (_prev: ActionState, form: FormData): Promise<ActionState> => {
    try {
      const actor = await requireActor();
      const message = await handler(form, actor);
      if (revalidate) revalidatePath(revalidate, "layout");
      return { ok: true, message: message ?? "Saved." };
    } catch (e) {
      return actionError(e);
    }
  };
}

export const createLeadAction = staffAction(async (form, actor) => {
  const { assertCan } = await import("@/modules/identity/actor");
  assertCan(actor, "crm.manage");
  const r = await captureLead({ firstName: s(form, "firstName"), lastName: s(form, "lastName"), email: s(form, "email"), phone: s(form, "phone"), interest: s(form, "interest") || undefined, message: s(form, "message") || undefined, source: s(form, "source") || "walk_in" });
  return r.duplicate ? "This contact already has an open lead — the inquiry was added to it." : "Lead created.";
}, "/staff/leads");

export const updateLeadAction = staffAction(async (form, actor) => {
  await updateLead(actor, { leadId: s(form, "leadId"), stage: (s(form, "stage") || undefined) as never, lostReason: s(form, "lostReason") || undefined, assignedToUserId: s(form, "assignedToUserId") || undefined });
  return "Lead updated.";
}, "/staff/leads");

export const addActivityAction = staffAction(async (form, actor) => {
  await addLeadActivity(actor, { leadId: s(form, "leadId"), type: s(form, "type") as "note", body: s(form, "body") });
  return "Logged.";
}, "/staff/leads");

export const addTaskAction = staffAction(async (form, actor) => {
  await addLeadTask(actor, { leadId: s(form, "leadId"), title: s(form, "title"), dueAt: clubTimeToUtc(s(form, "dueDate"), s(form, "dueTime") || "09:00") });
  return "Task added.";
}, "/staff/leads");

export const completeTaskAction = staffAction(async (form, actor) => {
  await completeLeadTask(actor, s(form, "taskId"));
  return "Task completed.";
}, "/staff");

export const tourStatusAction = staffAction(async (form, actor) => {
  await setTourStatus(actor, s(form, "tourId"), s(form, "status") as "completed");
  return "Tour updated.";
}, "/staff/leads");

export const membershipChangeAction = staffAction(async (form, actor) => {
  const r = await scheduleMembershipChange(actor, { membershipId: s(form, "membershipId"), type: s(form, "type") as "freeze", effectiveDate: s(form, "effectiveDate"), reason: s(form, "reason") });
  return r.applied ? "Change applied." : "Change scheduled for its effective date.";
}, "/staff/members");

export const accountSettingsAction = staffAction(async (form, actor) => {
  await updateAccountSettings(actor, { householdId: s(form, "householdId"), chargeEnabled: form.get("chargeEnabled") === "on", creditLimitCents: Math.round(Number(s(form, "creditLimit") || "0") * 100), status: s(form, "status") as "active" });
  return "Club-account settings saved.";
}, "/staff/members");

export const verifyGuardianAction = staffAction(async (form, actor) => {
  await verifyGuardianship(actor, s(form, "guardianPersonId"), s(form, "childPersonId"));
  return "Guardian verified.";
}, "/staff/members");

export const checkInAction = async (_prev: ActionState, form: FormData): Promise<ActionState> => {
  try {
    const r = await checkInMember(await requireActor(), s(form, "personId"));
    return r.result === "allowed" ? { ok: true, message: `✓ ${r.person.firstName} ${r.person.lastName} checked in (${r.planName}).` } : { ok: false, error: `✕ ${r.person.firstName} ${r.person.lastName}: ${r.reason}. Entry not recorded as allowed.` };
  } catch (e) {
    return actionError(e);
  }
};

export const createSessionAction = staffAction(async (form, actor) => {
  const created = await createSessions(actor, {
    serviceId: s(form, "serviceId"),
    date: s(form, "date"),
    time: s(form, "time"),
    capacity: s(form, "capacity") ? Number(s(form, "capacity")) : undefined,
    coachUserId: s(form, "coachUserId") || undefined,
    resourceId: s(form, "resourceId") || undefined,
    repeatWeeks: Number(s(form, "repeatWeeks") || "0"),
  });
  return `${created.length} session${created.length === 1 ? "" : "s"} scheduled.`;
}, "/staff/schedule");

export const cancelSessionAction = staffAction(async (form, actor) => {
  const r = await cancelSession(actor, s(form, "sessionId"));
  return `Session cancelled; ${r.cancelledBookings} booking(s) cancelled and credited.`;
}, "/staff/schedule");

export const attendanceAction = staffAction(async (form, actor) => {
  await markAttendance(actor, s(form, "bookingId"), s(form, "status") as "attended");
  return "Attendance saved.";
}, "/staff/schedule");

export const refundAction = staffAction(async (form, actor) => {
  const cents = Math.round(Number(s(form, "amount")) * 100);
  await refundPayment(actor, s(form, "paymentId"), cents, s(form, "reason") || "staff refund", { creditCharge: form.get("creditCharge") === "on" });
  return `Refund of ${formatMoney(cents)} submitted to the processor.`;
}, "/staff/billing");

export const retryWebhookAction = staffAction(async (form, actor) => {
  return (await retryFailedWebhook(actor, s(form, "eventId"))) ? "Event reprocessed." : "Event was not in a failed state.";
}, "/staff/billing");

export async function savePartnerAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await requireActor();
    const audience = s(form, "audience") as "public" | "members" | "plans";
    await savePartner(actor, {
      id: s(form, "id") || undefined,
      slug: s(form, "slug"),
      name: s(form, "name"),
      description: s(form, "description"),
      logoUrl: s(form, "logoUrl"),
      category: s(form, "category"),
      connectionMode: s(form, "connectionMode") as "link",
      approvedDomains: s(form, "approvedDomains").split(/[\s,]+/).filter(Boolean),
      bookingUrl: s(form, "bookingUrl"),
      bookingLabel: s(form, "bookingLabel"),
      accountUrl: s(form, "accountUrl"),
      accountLabel: s(form, "accountLabel"),
      supportUrl: s(form, "supportUrl"),
      deepLinkUrl: s(form, "deepLinkUrl"),
      visibility: { audience, planCodes: audience === "plans" ? form.getAll("planCodes").map(String) : undefined },
      launchTarget: s(form, "launchTarget") as "new_tab",
      status: s(form, "status") as "active",
      handlesHealthInfo: form.get("handlesHealthInfo") === "on",
      displayOrder: Number(s(form, "displayOrder") || "0"),
    });
  } catch (e) {
    return actionError(e);
  }
  revalidatePath("/staff/partners");
  redirect("/staff/partners?saved=1");
}
