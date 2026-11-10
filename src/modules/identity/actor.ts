import { eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { householdMembers, persons, staffRoles, type StaffRole } from "@/db/schema";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

/**
 * The authenticated caller. Every module function that touches private data takes an
 * Actor and authorises against it on the server; UI visibility is never the control.
 */
export type Actor = {
  userId: string;
  personId: string | null;
  householdIds: string[];
  roles: StaffRole[];
};

export async function loadActor(userId: string, tx: DbOrTx = db): Promise<Actor> {
  const [person] = await tx.select({ id: persons.id }).from(persons).where(eq(persons.userId, userId));
  const hh = person
    ? await tx.select({ id: householdMembers.householdId }).from(householdMembers).where(eq(householdMembers.personId, person.id))
    : [];
  const roles = await tx.select({ role: staffRoles.role }).from(staffRoles).where(eq(staffRoles.userId, userId));
  return { userId, personId: person?.id ?? null, householdIds: hh.map((h) => h.id), roles: roles.map((r) => r.role) };
}

/** What each staff role may do. Admin implicitly holds every capability. */
export const CAPABILITIES = {
  "crm.manage": ["sales", "manager"],
  "members.view": ["sales", "front_desk", "manager", "finance"],
  "members.manage": ["manager"],
  "checkin.perform": ["front_desk", "manager"],
  "schedule.view": ["front_desk", "coach", "manager", "sales", "kids_club"],
  "schedule.manage": ["manager"],
  "billing.view": ["finance", "manager"],
  "billing.manage": ["finance"],
  "partners.manage": [],
  "integrations.manage": [],
  "audit.view": ["manager", "finance"],
  "reports.view": ["manager", "finance", "sales"],
} as const satisfies Record<string, readonly StaffRole[]>;
export type Capability = keyof typeof CAPABILITIES;

export const isStaff = (a: Actor) => a.roles.length > 0;
export function can(a: Actor, cap: Capability): boolean {
  if (a.roles.includes("admin")) return true;
  return (CAPABILITIES[cap] as readonly StaffRole[]).some((r) => a.roles.includes(r));
}
export function assertCan(a: Actor, cap: Capability) {
  if (!can(a, cap)) throw new ForbiddenError();
}

/**
 * Members may only reach their own household. A missing/foreign household is reported as
 * "not found" so that identifiers cannot be probed.
 */
export function assertHouseholdMember(a: Actor, householdId: string) {
  if (!a.householdIds.includes(householdId)) throw new NotFoundError("Household");
}

export type HouseholdPermissions = {
  role: "primary" | "adult" | "dependent";
  canBookForHousehold: boolean;
  canManageBilling: boolean;
  canChargeAccount: boolean;
  chargeLimitCents: number | null;
};

export async function householdPermissions(tx: DbOrTx, personId: string, householdId: string): Promise<HouseholdPermissions | null> {
  const rows = await tx.select().from(householdMembers).where(eq(householdMembers.personId, personId));
  const row = rows.find((r) => r.householdId === householdId);
  if (!row) return null;
  return {
    role: row.role,
    canBookForHousehold: row.canBookForHousehold,
    canManageBilling: row.canManageBilling,
    canChargeAccount: row.canChargeAccount,
    chargeLimitCents: row.chargeLimitCents,
  };
}
