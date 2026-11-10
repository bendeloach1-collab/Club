"use server";

import { revalidatePath } from "next/cache";
import { actionError, type ActionState } from "@/lib/action";
import { requireActor } from "@/lib/session";
import { createAdultLogin, updateHouseholdPermissions } from "@/modules/identity/households";

export async function permissionsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await requireActor();
    const limit = String(form.get("chargeLimit") ?? "").trim();
    await updateHouseholdPermissions(actor, {
      householdId: String(form.get("householdId")),
      personId: String(form.get("personId")),
      canBookForHousehold: form.get("canBookForHousehold") === "on",
      canManageBilling: form.get("canManageBilling") === "on",
      canChargeAccount: form.get("canChargeAccount") === "on",
      chargeLimitCents: limit === "" ? null : Math.round(Number(limit) * 100),
    });
    revalidatePath("/portal/family");
    return { ok: true, message: "Permissions saved." };
  } catch (e) {
    return actionError(e);
  }
}

export async function adultLoginAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await requireActor();
    await createAdultLogin(actor, { householdId: String(form.get("householdId")), personId: String(form.get("personId")), email: String(form.get("email")), password: String(form.get("password")) });
    revalidatePath("/portal/family");
    return { ok: true, message: "Login created. Share the temporary password securely and ask them to change it." };
  } catch (e) {
    return actionError(e);
  }
}
