import { and, eq, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db";
import { checkins, membershipEvents, memberships, persons } from "@/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { clubDate } from "@/lib/time";
import { audit } from "@/modules/audit/audit";
import { assertCan, type Actor } from "@/modules/identity/actor";
import { activeMembershipFor } from "./plans";

export const membershipChangeSchema = z.object({
  membershipId: z.string().uuid(),
  type: z.enum(["freeze", "unfreeze", "cancel"]),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().max(500).default(""),
});

const TRANSITIONS = {
  freeze: { from: ["active"], to: "frozen" },
  unfreeze: { from: ["frozen"], to: "active" },
  cancel: { from: ["active", "frozen", "pending_payment"], to: "cancelled" },
} as const;

async function applyEvent(tx: Tx, ev: typeof membershipEvents.$inferSelect) {
  const t = TRANSITIONS[ev.type as keyof typeof TRANSITIONS];
  if (!t) return false;
  const [m] = await tx.select().from(memberships).where(eq(memberships.id, ev.membershipId)).for("update");
  if (!m) return false;
  const ok = (t.from as readonly string[]).includes(m.status);
  if (ok) {
    await tx
      .update(memberships)
      .set({ status: t.to, endDate: t.to === "cancelled" ? ev.effectiveDate : m.endDate, updatedAt: new Date() })
      .where(eq(memberships.id, m.id));
  }
  await tx
    .update(membershipEvents)
    .set({ appliedAt: new Date(), data: { ...ev.data, applied: ok, ...(ok ? {} : { skippedBecauseStatus: m.status }) } })
    .where(eq(membershipEvents.id, ev.id));
  return ok;
}

/**
 * Record an effective-dated membership change. Changes dated today or earlier apply
 * immediately; future-dated changes are stored and applied by the daily job.
 */
export async function scheduleMembershipChange(actor: Actor, raw: z.input<typeof membershipChangeSchema>) {
  assertCan(actor, "members.manage");
  const input = membershipChangeSchema.parse(raw);
  const today = clubDate();
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(memberships).where(eq(memberships.id, input.membershipId)).for("update");
    if (!m) throw new NotFoundError("Membership");
    if (input.effectiveDate < m.startDate) throw new ValidationError("Effective date is before the membership start date.");
    const t = TRANSITIONS[input.type];
    if (input.effectiveDate <= today && !(t.from as readonly string[]).includes(m.status)) {
      throw new ConflictError(`A ${m.status.replace("_", " ")} membership cannot be changed this way.`);
    }
    const [ev] = await tx
      .insert(membershipEvents)
      .values({ membershipId: m.id, type: input.type, effectiveDate: input.effectiveDate, createdByUserId: actor.userId, data: { reason: input.reason } })
      .returning();
    const applied = input.effectiveDate <= today ? await applyEvent(tx, ev!) : false;
    await audit(tx, {
      actorUserId: actor.userId,
      action: `membership.${input.type}`,
      entityType: "membership",
      entityId: m.id,
      householdId: m.householdId,
      data: { effectiveDate: input.effectiveDate, applied },
    });
    return { eventId: ev!.id, applied };
  });
}

/** Daily job: apply scheduled changes whose effective date has arrived. */
export async function applyDueMembershipChanges(today = clubDate()) {
  const due = await db.select().from(membershipEvents).where(and(isNull(membershipEvents.appliedAt), lte(membershipEvents.effectiveDate, today)));
  let applied = 0;
  for (const ev of due) {
    await db.transaction(async (tx) => {
      if (await applyEvent(tx, ev)) applied++;
    });
  }
  return { due: due.length, applied };
}

/** Front-desk check-in: access is decided on the server from live membership status. */
export async function checkInMember(actor: Actor, personId: string) {
  assertCan(actor, "checkin.perform");
  return db.transaction(async (tx) => {
    const [person] = await tx.select().from(persons).where(eq(persons.id, personId));
    if (!person) throw new NotFoundError("Member");
    const membership = await activeMembershipFor(tx, personId);
    const result = membership ? ("allowed" as const) : ("denied" as const);
    const reason = membership ? null : "No active membership";
    const [row] = await tx.insert(checkins).values({ personId, staffUserId: actor.userId, result, reason }).returning();
    await audit(tx, { actorUserId: actor.userId, action: `checkin.${result}`, entityType: "person", entityId: personId });
    return { checkin: row!, person: { id: person.id, firstName: person.firstName, lastName: person.lastName, memberNumber: person.memberNumber }, planName: membership?.planName ?? null, result, reason };
  });
}
