import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ForbiddenError, UnauthenticatedError } from "@/lib/errors";
import { can, isStaff, loadActor, type Actor, type Capability } from "@/modules/identity/actor";

/** Resolve the caller from the session cookie (memoised per request). */
export const getActor = cache(async (): Promise<Actor | null> => {
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s?.user) return null;
  return loadActor(s.user.id);
});

export async function requireActor(): Promise<Actor> {
  const a = await getActor();
  if (!a) throw new UnauthenticatedError();
  return a;
}

/** For pages: redirect to sign-in rather than throwing. */
export async function requireMemberPage(): Promise<Actor & { personId: string }> {
  const a = await getActor();
  if (!a) redirect("/login");
  if (!a.personId || a.householdIds.length === 0) redirect(isStaff(a) ? "/staff" : "/login");
  return a as Actor & { personId: string };
}

export async function requireStaffPage(cap?: Capability): Promise<Actor> {
  const a = await getActor();
  if (!a) redirect("/login");
  if (!isStaff(a)) redirect("/portal");
  if (cap && !can(a, cap)) throw new ForbiddenError();
  return a;
}
