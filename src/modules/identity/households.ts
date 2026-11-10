import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db";
import { billingAccounts, guardianships, householdMembers, households, membershipPlans, memberships, persons, user } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/modules/audit/audit";
import { assertCan, assertHouseholdMember, can, type Actor } from "./actor";
import { createLogin } from "./people";

/** Authorise a household read: members see only their own household; staff need `members.view`. */
function authoriseHouseholdRead(actor: Actor, householdId: string) {
  if (actor.householdIds.includes(householdId)) return;
  if (can(actor, "members.view")) return;
  throw new NotFoundError("Household");
}

export async function getHouseholdOverview(actor: Actor, householdId: string, tx: DbOrTx = db) {
  authoriseHouseholdRead(actor, householdId);
  const [household] = await tx.select().from(households).where(eq(households.id, householdId));
  if (!household) throw new NotFoundError("Household");
  const members = await tx
    .select({
      personId: persons.id,
      firstName: persons.firstName,
      lastName: persons.lastName,
      email: persons.email,
      phone: persons.phone,
      dateOfBirth: persons.dateOfBirth,
      memberNumber: persons.memberNumber,
      hasLogin: sql<boolean>`${persons.userId} is not null`,
      role: householdMembers.role,
      canBookForHousehold: householdMembers.canBookForHousehold,
      canManageBilling: householdMembers.canManageBilling,
      canChargeAccount: householdMembers.canChargeAccount,
      chargeLimitCents: householdMembers.chargeLimitCents,
    })
    .from(householdMembers)
    .innerJoin(persons, eq(persons.id, householdMembers.personId))
    .where(eq(householdMembers.householdId, householdId))
    .orderBy(sql`case ${householdMembers.role} when 'primary' then 0 when 'adult' then 1 else 2 end`, asc(persons.firstName));
  const membershipRows = await tx
    .select({ membership: memberships, plan: membershipPlans })
    .from(memberships)
    .innerJoin(membershipPlans, eq(membershipPlans.id, memberships.planId))
    .where(eq(memberships.householdId, householdId))
    .orderBy(desc(memberships.createdAt));
  const [billing] = await tx.select().from(billingAccounts).where(eq(billingAccounts.householdId, householdId));
  const guardians = await tx
    .select()
    .from(guardianships)
    .where(
      inArray(
        guardianships.childPersonId,
        members.length ? members.map((m) => m.personId) : ["00000000-0000-0000-0000-000000000000"],
      ),
    );
  return { household, members, memberships: membershipRows, current: membershipRows[0] ?? null, billing: billing ?? null, guardianships: guardians };
}

export const permissionsSchema = z.object({
  householdId: z.string().uuid(),
  personId: z.string().uuid(),
  canBookForHousehold: z.boolean(),
  canManageBilling: z.boolean(),
  canChargeAccount: z.boolean(),
  chargeLimitCents: z.number().int().min(0).max(10_000_000).nullable(),
});

/** Only the primary member (or authorised staff) may change another adult's permissions. */
export async function updateHouseholdPermissions(actor: Actor, raw: z.input<typeof permissionsSchema>) {
  const input = permissionsSchema.parse(raw);
  return db.transaction(async (tx) => {
    const staff = can(actor, "members.manage");
    if (!staff) {
      assertHouseholdMember(actor, input.householdId);
      const [me] = await tx
        .select()
        .from(householdMembers)
        .where(and(eq(householdMembers.householdId, input.householdId), eq(householdMembers.personId, actor.personId!)));
      if (me?.role !== "primary") throw new ForbiddenError("Only the primary member can change household permissions.");
    }
    const [target] = await tx
      .select()
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, input.householdId), eq(householdMembers.personId, input.personId)))
      .for("update");
    if (!target) throw new NotFoundError("Household member");
    if (target.role === "dependent") throw new ValidationError("Dependents cannot hold booking or billing permissions.");
    if (target.role === "primary" && !staff) throw new ValidationError("The primary member's permissions are managed by the club.");
    await tx
      .update(householdMembers)
      .set({
        canBookForHousehold: input.canBookForHousehold,
        canManageBilling: input.canManageBilling,
        canChargeAccount: input.canChargeAccount,
        chargeLimitCents: input.chargeLimitCents,
      })
      .where(and(eq(householdMembers.householdId, input.householdId), eq(householdMembers.personId, input.personId)));
    await audit(tx, {
      actorUserId: actor.userId,
      action: "permission.household_updated",
      entityType: "person",
      entityId: input.personId,
      householdId: input.householdId,
      data: { canBookForHousehold: input.canBookForHousehold, canManageBilling: input.canManageBilling, canChargeAccount: input.canChargeAccount, chargeLimitCents: input.chargeLimitCents },
    });
  });
}

export const adultLoginSchema = z.object({
  householdId: z.string().uuid(),
  personId: z.string().uuid(),
  email: z.string().trim().email().max(200),
  password: z.string().min(10).max(128),
});

/**
 * Give another adult in the household their own login. Interim Milestone 1 mechanism:
 * the primary sets an initial password to hand over; emailed invitations arrive with
 * transactional email in Milestone 2.
 */
export async function createAdultLogin(actor: Actor, raw: z.input<typeof adultLoginSchema>) {
  const input = adultLoginSchema.parse(raw);
  return db.transaction(async (tx) => {
    if (!can(actor, "members.manage")) {
      assertHouseholdMember(actor, input.householdId);
      const [me] = await tx
        .select()
        .from(householdMembers)
        .where(and(eq(householdMembers.householdId, input.householdId), eq(householdMembers.personId, actor.personId!)));
      if (me?.role !== "primary") throw new ForbiddenError("Only the primary member can create logins for the household.");
    }
    const [row] = await tx
      .select({ hm: householdMembers, person: persons })
      .from(householdMembers)
      .innerJoin(persons, eq(persons.id, householdMembers.personId))
      .where(and(eq(householdMembers.householdId, input.householdId), eq(householdMembers.personId, input.personId)))
      .for("update");
    if (!row) throw new NotFoundError("Household member");
    if (row.hm.role === "dependent") throw new ValidationError("Only adults can have their own login.");
    if (row.person.userId) throw new ConflictError("This person already has a login.");
    const userId = await createLogin(tx, { email: input.email, name: `${row.person.firstName} ${row.person.lastName}`, password: input.password });
    await tx.update(persons).set({ userId, email: input.email, emailNormalized: input.email.toLowerCase(), updatedAt: new Date() }).where(eq(persons.id, input.personId));
    await audit(tx, { actorUserId: actor.userId, action: "permission.login_created", entityType: "person", entityId: input.personId, householdId: input.householdId });
    return userId;
  });
}

/** Staff member search, paginated. Front desk sees identity and status only. */
export async function searchMembers(actor: Actor, opts: { q?: string; page?: number; pageSize?: number }) {
  assertCan(actor, "members.view");
  const pageSize = Math.min(opts.pageSize ?? 25, 100);
  const page = Math.max(opts.page ?? 1, 1);
  const q = opts.q?.trim();
  const where = q
    ? or(
        ilike(persons.lastName, `${q}%`),
        ilike(persons.firstName, `${q}%`),
        eq(persons.emailNormalized, q.toLowerCase()),
        eq(persons.memberNumber, q.toUpperCase()),
        sql`${persons.firstName} || ' ' || ${persons.lastName} ilike ${q + "%"}`,
      )
    : undefined;
  const rows = await db
    .select({
      personId: persons.id,
      firstName: persons.firstName,
      lastName: persons.lastName,
      memberNumber: persons.memberNumber,
      householdId: householdMembers.householdId,
      role: householdMembers.role,
      membershipStatus: sql<string | null>`(select m.status from memberships m where m.household_id = ${householdMembers.householdId} order by m.created_at desc limit 1)`,
    })
    .from(persons)
    .innerJoin(householdMembers, eq(householdMembers.personId, persons.id))
    .where(where)
    .orderBy(asc(persons.lastName), asc(persons.firstName), asc(persons.id))
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);
  return { rows: rows.slice(0, pageSize), page, hasMore: rows.length > pageSize };
}

export async function listStaff(tx: DbOrTx = db) {
  return tx
    .select({ userId: user.id, name: user.name, roles: sql<string[]>`array_agg(sr.role order by sr.role)` })
    .from(user)
    .innerJoin(sql`staff_roles sr`, sql`sr.user_id = ${user.id}`)
    .groupBy(user.id, user.name)
    .orderBy(asc(user.name));
}
