import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx, type Tx } from "@/db";
import { consentEvents, leadActivities, leads, leadTasks, LEAD_STAGES, persons, staffRoles, tours, user } from "@/db/schema";
import { ConflictError, NotFoundError, PG_UNIQUE_VIOLATION, pgErrorCode, ValidationError } from "@/lib/errors";
import { normalizeEmail, normalizePhone } from "@/lib/normalize";
import { addDays, clubDate, clubTimeToUtc, weekdayOf } from "@/lib/time";
import { audit } from "@/modules/audit/audit";
import { assertCan, type Actor } from "@/modules/identity/actor";

const OPEN_STAGES = ["new", "contacted", "tour_scheduled", "toured", "proposal"] as const;

export const leadCaptureSchema = z
  .object({
    firstName: z.string().trim().min(1, "Required").max(80),
    lastName: z.string().trim().min(1, "Required").max(80),
    email: z.string().trim().email("Enter a valid email").max(200).optional().or(z.literal("")),
    phone: z.string().trim().max(30).optional().or(z.literal("")),
    interest: z.string().trim().max(60).optional(),
    message: z.string().trim().max(2000).optional(),
    source: z.string().trim().max(60).default("website"),
    utmSource: z.string().trim().max(120).optional(),
    utmMedium: z.string().trim().max(120).optional(),
    utmCampaign: z.string().trim().max(120).optional(),
    marketingEmailOptIn: z.boolean().default(false),
    marketingSmsOptIn: z.boolean().default(false),
  })
  .refine((v) => normalizeEmail(v.email) || normalizePhone(v.phone), { message: "Provide an email or phone number.", path: ["email"] });
export type LeadCaptureInput = z.input<typeof leadCaptureSchema>;

async function pickAssignee(tx: DbOrTx): Promise<string | null> {
  // Least-loaded salesperson gets the next lead.
  const rows = await tx
    .select({
      userId: staffRoles.userId,
      open: sql<number>`(select count(*)::int from leads l where l.assigned_to_user_id = staff_roles.user_id and l.stage in ('new','contacted','tour_scheduled','toured','proposal'))`,
    })
    .from(staffRoles)
    .where(eq(staffRoles.role, "sales"))
    .orderBy(sql`2`, asc(staffRoles.userId))
    .limit(1);
  return rows[0]?.userId ?? null;
}

async function captureLeadTx(tx: Tx, input: z.output<typeof leadCaptureSchema>) {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  // Serialise captures for the same contact so simultaneous submissions cannot both insert.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"lead:" + (email ?? phone)}))`);
  const match = [];
  if (email) match.push(eq(leads.emailNormalized, email));
  if (phone) match.push(eq(leads.phoneNormalized, phone));
  const [existing] = await tx
    .select()
    .from(leads)
    .where(and(or(...match), inArray(leads.stage, [...OPEN_STAGES])))
    .orderBy(desc(leads.createdAt))
    .limit(1);

  const inquiryBody = [input.message, input.interest ? `Interest: ${input.interest}` : null, `Source: ${input.source}`].filter(Boolean).join("\n");

  if (existing) {
    // Duplicate inquiry: enrich the existing lead instead of creating a second identity.
    await tx
      .update(leads)
      .set({
        email: existing.email ?? (input.email || null),
        emailNormalized: existing.emailNormalized ?? email,
        phone: existing.phone ?? (input.phone || null),
        phoneNormalized: existing.phoneNormalized ?? phone,
        interest: input.interest ?? existing.interest,
        marketingEmailOptIn: existing.marketingEmailOptIn || input.marketingEmailOptIn,
        marketingSmsOptIn: existing.marketingSmsOptIn || input.marketingSmsOptIn,
        lastActivityAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(leads.id, existing.id));
    await tx.insert(leadActivities).values({ leadId: existing.id, type: "inquiry", body: `Repeat inquiry.\n${inquiryBody}` });
    return { leadId: existing.id, duplicate: true };
  }

  const assignee = await pickAssignee(tx);
  const [lead] = await tx
    .insert(leads)
    .values({
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email || null,
      emailNormalized: email,
      phone: input.phone || null,
      phoneNormalized: phone,
      interest: input.interest ?? null,
      source: input.source,
      utmSource: input.utmSource ?? null,
      utmMedium: input.utmMedium ?? null,
      utmCampaign: input.utmCampaign ?? null,
      assignedToUserId: assignee,
      marketingEmailOptIn: input.marketingEmailOptIn,
      marketingSmsOptIn: input.marketingSmsOptIn,
    })
    .returning();
  await tx.insert(leadActivities).values({ leadId: lead!.id, type: "inquiry", body: inquiryBody });
  await tx.insert(consentEvents).values([
    { leadId: lead!.id, channel: "email", granted: input.marketingEmailOptIn, source: input.source },
    { leadId: lead!.id, channel: "sms", granted: input.marketingSmsOptIn, source: input.source },
  ]);
  // Staff-only hint; nothing about existing members is ever returned to the public caller.
  if (email) {
    const [known] = await tx.select({ id: persons.id }).from(persons).where(eq(persons.emailNormalized, email)).limit(1);
    if (known) await tx.insert(leadActivities).values({ leadId: lead!.id, type: "system", body: "Possible duplicate: this email matches an existing person record. Verify before merging." });
  }
  await tx.insert(leadTasks).values({ leadId: lead!.id, title: "Make first contact", dueAt: new Date(Date.now() + 24 * 3600 * 1000), assignedToUserId: assignee });
  return { leadId: lead!.id, duplicate: false };
}

/** Public lead capture with duplicate detection and source attribution. */
export async function captureLead(raw: LeadCaptureInput) {
  const input = leadCaptureSchema.parse(raw);
  return db.transaction((tx) => captureLeadTx(tx, input));
}

/* ------------------------------- Tours ---------------------------------- */

const TOUR_HOURS = { start: 9, end: 18 }; // club-local, last tour starts at 17:00
const TOUR_DAYS_AHEAD = 14;

/** Open tour slots (club time) for the next two weeks, excluding Sundays and taken slots. */
export async function availableTourSlots(now = new Date(), tx: DbOrTx = db) {
  const today = clubDate(now);
  const slots: Date[] = [];
  for (let d = 1; d <= TOUR_DAYS_AHEAD; d++) {
    const date = addDays(today, d);
    if (weekdayOf(date) === 0) continue;
    for (let h = TOUR_HOURS.start; h < TOUR_HOURS.end; h++) slots.push(clubTimeToUtc(date, `${String(h).padStart(2, "0")}:00`));
  }
  const taken = await tx
    .select({ at: tours.scheduledAt })
    .from(tours)
    .where(and(eq(tours.status, "scheduled"), gte(tours.scheduledAt, now)));
  const takenSet = new Set(taken.map((t) => t.at.getTime()));
  return slots.filter((s) => !takenSet.has(s.getTime()));
}

export const tourRequestSchema = z.object({ lead: leadCaptureSchema, scheduledAt: z.coerce.date() });

/** Public tour scheduling: captures/dedupes the lead and books the slot atomically. */
export async function scheduleTour(raw: z.input<typeof tourRequestSchema>, actorUserId: string | null = null) {
  const input = tourRequestSchema.parse(raw);
  const open = await availableTourSlots();
  if (!open.some((s) => s.getTime() === input.scheduledAt.getTime())) throw new ConflictError("That tour time is no longer available. Please choose another.", "slot_unavailable");
  try {
    return await db.transaction(async (tx) => {
      const { leadId, duplicate } = await captureLeadTx(tx, { ...input.lead, source: input.lead.source || "website" });
      const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId));
      // One upcoming tour per lead: rescheduling replaces the earlier one.
      await tx.update(tours).set({ status: "cancelled" }).where(and(eq(tours.leadId, leadId), eq(tours.status, "scheduled")));
      const [tour] = await tx.insert(tours).values({ leadId, scheduledAt: input.scheduledAt, staffUserId: lead!.assignedToUserId }).returning();
      if (lead!.stage === "new" || lead!.stage === "contacted") await tx.update(leads).set({ stage: "tour_scheduled", updatedAt: new Date() }).where(eq(leads.id, leadId));
      await tx.insert(leadActivities).values({ leadId, type: "tour", body: `Tour scheduled for ${input.scheduledAt.toISOString()}`, createdByUserId: actorUserId });
      return { leadId, tourId: tour!.id, duplicate };
    });
  } catch (e) {
    if (pgErrorCode(e) === PG_UNIQUE_VIOLATION) throw new ConflictError("That tour time was just taken. Please choose another.", "slot_unavailable");
    throw e;
  }
}

/* ----------------------------- Staff CRM -------------------------------- */

export async function listLeads(actor: Actor, opts: { stage?: string; q?: string; mine?: boolean; page?: number; pageSize?: number }) {
  assertCan(actor, "crm.manage");
  const pageSize = Math.min(opts.pageSize ?? 25, 100);
  const page = Math.max(opts.page ?? 1, 1);
  const conds = [];
  if (opts.stage && (LEAD_STAGES as readonly string[]).includes(opts.stage)) conds.push(eq(leads.stage, opts.stage as (typeof LEAD_STAGES)[number]));
  if (opts.mine) conds.push(eq(leads.assignedToUserId, actor.userId));
  const q = opts.q?.trim();
  if (q) conds.push(or(ilike(leads.lastName, `${q}%`), ilike(leads.firstName, `${q}%`), eq(leads.emailNormalized, q.toLowerCase()), eq(leads.phoneNormalized, normalizePhone(q) ?? "")));
  const rows = await db
    .select({ lead: leads, assigneeName: user.name })
    .from(leads)
    .leftJoin(user, eq(user.id, leads.assignedToUserId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(leads.lastActivityAt), desc(leads.id))
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);
  return { rows: rows.slice(0, pageSize), page, hasMore: rows.length > pageSize };
}

export async function pipelineCounts(actor: Actor) {
  assertCan(actor, "crm.manage");
  const rows = await db.select({ stage: leads.stage, count: sql<number>`count(*)::int` }).from(leads).groupBy(leads.stage);
  return Object.fromEntries(LEAD_STAGES.map((s) => [s, rows.find((r) => r.stage === s)?.count ?? 0])) as Record<(typeof LEAD_STAGES)[number], number>;
}

export async function getLead(actor: Actor, leadId: string) {
  assertCan(actor, "crm.manage");
  const [row] = await db.select({ lead: leads, assigneeName: user.name }).from(leads).leftJoin(user, eq(user.id, leads.assignedToUserId)).where(eq(leads.id, leadId));
  if (!row) throw new NotFoundError("Lead");
  const [activities, tasks, leadTours] = await Promise.all([
    db
      .select({ a: leadActivities, by: user.name })
      .from(leadActivities)
      .leftJoin(user, eq(user.id, leadActivities.createdByUserId))
      .where(eq(leadActivities.leadId, leadId))
      .orderBy(desc(leadActivities.createdAt))
      .limit(200),
    db.select().from(leadTasks).where(eq(leadTasks.leadId, leadId)).orderBy(asc(leadTasks.dueAt)),
    db.select().from(tours).where(eq(tours.leadId, leadId)).orderBy(desc(tours.scheduledAt)),
  ]);
  return { ...row, activities, tasks, tours: leadTours };
}

export const leadUpdateSchema = z.object({
  leadId: z.string().uuid(),
  stage: z.enum(LEAD_STAGES).optional(),
  lostReason: z.string().trim().max(300).optional(),
  assignedToUserId: z.string().optional(),
});

export async function updateLead(actor: Actor, raw: z.input<typeof leadUpdateSchema>) {
  assertCan(actor, "crm.manage");
  const input = leadUpdateSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [lead] = await tx.select().from(leads).where(eq(leads.id, input.leadId)).for("update");
    if (!lead) throw new NotFoundError("Lead");
    const patch: Partial<typeof leads.$inferInsert> = { updatedAt: new Date(), lastActivityAt: new Date() };
    if (input.stage && input.stage !== lead.stage) {
      if (input.stage === "won" && !lead.convertedMembershipId) throw new ValidationError("A lead is marked won automatically when the membership is activated.");
      if (input.stage === "lost" && !input.lostReason) throw new ValidationError("Give a reason when marking a lead lost.");
      patch.stage = input.stage;
      patch.lostReason = input.stage === "lost" ? input.lostReason : null;
      await tx.insert(leadActivities).values({ leadId: lead.id, type: "stage_change", body: `Stage: ${lead.stage} → ${input.stage}${input.lostReason ? ` (${input.lostReason})` : ""}`, createdByUserId: actor.userId });
    }
    if (input.assignedToUserId && input.assignedToUserId !== lead.assignedToUserId) {
      const [assignee] = await tx.select({ name: user.name }).from(user).innerJoin(staffRoles, eq(staffRoles.userId, user.id)).where(eq(user.id, input.assignedToUserId)).limit(1);
      if (!assignee) throw new ValidationError("Leads can only be assigned to staff.");
      patch.assignedToUserId = input.assignedToUserId;
      await tx.insert(leadActivities).values({ leadId: lead.id, type: "system", body: `Assigned to ${assignee.name}`, createdByUserId: actor.userId });
    }
    await tx.update(leads).set(patch).where(eq(leads.id, lead.id));
    await audit(tx, { actorUserId: actor.userId, action: "lead.updated", entityType: "lead", entityId: lead.id, data: { stage: patch.stage, assignedToUserId: patch.assignedToUserId } });
  });
}

export const activitySchema = z.object({ leadId: z.string().uuid(), type: z.enum(["note", "call", "email", "sms"]), body: z.string().trim().min(1).max(4000) });

export async function addLeadActivity(actor: Actor, raw: z.input<typeof activitySchema>) {
  assertCan(actor, "crm.manage");
  const input = activitySchema.parse(raw);
  await db.transaction(async (tx) => {
    const [lead] = await tx.select().from(leads).where(eq(leads.id, input.leadId)).for("update");
    if (!lead) throw new NotFoundError("Lead");
    await tx.insert(leadActivities).values({ ...input, createdByUserId: actor.userId });
    await tx
      .update(leads)
      .set({ lastActivityAt: new Date(), stage: lead.stage === "new" && input.type !== "note" ? "contacted" : lead.stage })
      .where(eq(leads.id, lead.id));
  });
}

export const taskSchema = z.object({ leadId: z.string().uuid(), title: z.string().trim().min(1).max(200), dueAt: z.coerce.date(), assignedToUserId: z.string().optional() });

export async function addLeadTask(actor: Actor, raw: z.input<typeof taskSchema>) {
  assertCan(actor, "crm.manage");
  const input = taskSchema.parse(raw);
  const [lead] = await db.select({ id: leads.id }).from(leads).where(eq(leads.id, input.leadId));
  if (!lead) throw new NotFoundError("Lead");
  await db.insert(leadTasks).values({ leadId: input.leadId, title: input.title, dueAt: input.dueAt, assignedToUserId: input.assignedToUserId ?? actor.userId, createdByUserId: actor.userId });
}

export async function completeLeadTask(actor: Actor, taskId: string) {
  assertCan(actor, "crm.manage");
  await db.update(leadTasks).set({ completedAt: new Date() }).where(and(eq(leadTasks.id, taskId), isNull(leadTasks.completedAt)));
}

export async function setTourStatus(actor: Actor, tourId: string, status: "completed" | "no_show" | "cancelled") {
  assertCan(actor, "crm.manage");
  await db.transaction(async (tx) => {
    const [tour] = await tx.select().from(tours).where(eq(tours.id, tourId)).for("update");
    if (!tour) throw new NotFoundError("Tour");
    if (tour.status !== "scheduled") throw new ConflictError("This tour has already been closed.");
    await tx.update(tours).set({ status }).where(eq(tours.id, tourId));
    await tx.insert(leadActivities).values({ leadId: tour.leadId, type: "tour", body: `Tour ${status.replace("_", " ")}`, createdByUserId: actor.userId });
    if (status === "completed") await tx.update(leads).set({ stage: "toured", lastActivityAt: new Date() }).where(and(eq(leads.id, tour.leadId), inArray(leads.stage, ["new", "contacted", "tour_scheduled"])));
  });
}

export async function openTasks(actor: Actor, opts: { mine?: boolean; limit?: number } = {}) {
  assertCan(actor, "crm.manage");
  return db
    .select({ task: leadTasks, leadFirst: leads.firstName, leadLast: leads.lastName })
    .from(leadTasks)
    .innerJoin(leads, eq(leads.id, leadTasks.leadId))
    .where(and(isNull(leadTasks.completedAt), opts.mine ? eq(leadTasks.assignedToUserId, actor.userId) : undefined))
    .orderBy(asc(leadTasks.dueAt))
    .limit(opts.limit ?? 20);
}

export async function upcomingTours(actor: Actor, limit = 20) {
  assertCan(actor, "crm.manage");
  return db
    .select({ tour: tours, leadFirst: leads.firstName, leadLast: leads.lastName })
    .from(tours)
    .innerJoin(leads, eq(leads.id, tours.leadId))
    .where(and(eq(tours.status, "scheduled"), gte(tours.scheduledAt, new Date(Date.now() - 3600 * 1000))))
    .orderBy(asc(tours.scheduledAt))
    .limit(limit);
}

/** Conversion by source over a date range: leads → tours → members. */
export async function conversionReport(actor: Actor, opts: { from?: Date; to?: Date } = {}) {
  assertCan(actor, "reports.view");
  const from = opts.from ?? new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const to = opts.to ?? new Date();
  return db
    .select({
      source: leads.source,
      leads: sql<number>`count(*)::int`,
      toured: sql<number>`count(*) filter (where exists (select 1 from tours t where t.lead_id = leads.id and t.status = 'completed'))::int`,
      won: sql<number>`count(*) filter (where ${leads.stage} = 'won')::int`,
      lost: sql<number>`count(*) filter (where ${leads.stage} = 'lost')::int`,
    })
    .from(leads)
    .where(and(gte(leads.createdAt, from), lt(leads.createdAt, to)))
    .groupBy(leads.source)
    .orderBy(desc(sql`count(*)`));
}
