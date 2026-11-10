"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { staffRoles, user } from "@/db/schema";
import { auth } from "@/lib/auth";
import type { ActionState } from "@/lib/action";

export async function loginAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "");
  try {
    await auth.api.signInEmail({ body: { email, password }, headers: await headers() });
  } catch {
    // One message for every failure so accounts cannot be enumerated.
    return { ok: false, error: "That email and password combination was not recognised." };
  }
  const [staff] = await db.select({ role: staffRoles.role }).from(staffRoles).innerJoin(user, eq(user.id, staffRoles.userId)).where(eq(user.email, email)).limit(1);
  // Only same-site relative paths are honoured, never an absolute URL.
  const safeNext = /^\/(?!\/)[\w\-/?=&%.]*$/.test(next) ? next : null;
  redirect(safeNext ?? (staff ? "/staff" : "/portal"));
}

export async function logoutAction() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}
