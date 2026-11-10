import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db";
import { partnerLaunchEvents, partnerServices, PARTNER_MODES, PARTNER_STATUSES, type PartnerVisibility } from "@/db/schema";
import { AppError, ConflictError, NotFoundError, PG_UNIQUE_VIOLATION, pgErrorCode, ValidationError } from "@/lib/errors";
import { audit } from "@/modules/audit/audit";
import { assertCan, can, type Actor } from "@/modules/identity/actor";
import { activeMembershipFor } from "@/modules/membership/plans";

export type Partner = typeof partnerServices.$inferSelect;
export type LinkKind = "booking" | "account" | "support";

/* ------------------------------ URL safety ------------------------------ */

const SENSITIVE_PARAM = /(pass(word)?|pwd|secret|token|api[-_]?key|auth|session|ssn|dob|mrn|patient|member[-_]?id|email|phone)/i;

export function normalizeDomain(d: string): string {
  return d.trim().toLowerCase().replace(/\.$/, "");
}

/** `example.com` matches only that host; `*.example.com` matches its sub-domains (not the apex). */
export function hostIsApproved(host: string, approved: string[]): boolean {
  const h = normalizeDomain(host);
  return approved.map(normalizeDomain).some((d) => (d.startsWith("*.") ? h.endsWith(d.slice(1)) && h.length > d.length - 1 : h === d));
}

/**
 * A partner destination is acceptable only if it is an absolute HTTPS URL on an approved
 * domain, on the default port, with no embedded credentials and no query parameters that
 * look like credentials or personal data. Returns a problem description, or null if safe.
 */
export function partnerUrlProblem(raw: string, approvedDomains: string[]): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "is not a valid absolute URL";
  }
  if (u.protocol !== "https:") return "must use https://";
  if (u.username || u.password) return "must not contain embedded credentials";
  if (u.port && u.port !== "443") return "must not use a non-standard port";
  if (!hostIsApproved(u.hostname, approvedDomains)) return `host ${u.hostname} is not in the approved domains`;
  for (const k of u.searchParams.keys()) if (SENSITIVE_PARAM.test(k)) return `must not carry the sensitive query parameter "${k}"`;
  return null;
}

const domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/, "Enter a hostname such as book.partner.com or *.partner.com");
const optionalUrl = z.string().trim().max(500).optional().or(z.literal("")).transform((v) => v || null);
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal("")).transform((v) => v || null);

export const partnerSchema = z.object({
  id: z.string().uuid().optional(),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,60}$/, "Lowercase letters, numbers and hyphens"),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(""),
  logoUrl: optionalUrl,
  category: z.string().trim().min(1).max(40),
  connectionMode: z.enum(PARTNER_MODES),
  approvedDomains: z.array(domain).max(20),
  bookingUrl: optionalUrl,
  bookingLabel: optionalText(40),
  accountUrl: optionalUrl,
  accountLabel: optionalText(40),
  supportUrl: optionalUrl,
  deepLinkUrl: optionalUrl,
  visibility: z.object({ audience: z.enum(["public", "members", "plans"]), planCodes: z.array(z.string()).optional() }),
  launchTarget: z.enum(["new_tab", "same_tab"]),
  status: z.enum(PARTNER_STATUSES),
  handlesHealthInfo: z.boolean().default(false),
  displayOrder: z.number().int().min(0).max(9999).default(0),
});
export type PartnerInput = z.input<typeof partnerSchema>;

/** Configuration validation used on save and shown in the Integrations area. */
export function validatePartnerConfig(p: Pick<Partner, "approvedDomains" | "bookingUrl" | "accountUrl" | "supportUrl" | "deepLinkUrl" | "status" | "connectionMode" | "logoUrl">): string[] {
  const problems: string[] = [];
  const check = (label: string, url: string | null) => {
    if (!url) return;
    const problem = partnerUrlProblem(url, p.approvedDomains);
    if (problem) problems.push(`${label} ${problem}.`);
  };
  check("Booking URL", p.bookingUrl);
  check("Account URL", p.accountUrl);
  check("Support URL", p.supportUrl);
  check("Deep link URL", p.deepLinkUrl);
  if (p.logoUrl && !/^https:\/\//.test(p.logoUrl) && !p.logoUrl.startsWith("/")) problems.push("Logo URL must be https:// or a site-relative path.");
  if (p.status === "active") {
    if (p.approvedDomains.length === 0) problems.push("An active partner needs at least one approved domain.");
    if (!p.bookingUrl && !p.accountUrl) problems.push("An active partner needs a booking URL or an account URL.");
  }
  if (p.connectionMode === "deep_link" && !p.bookingUrl) problems.push("Deep-link mode requires a booking URL as the web fallback.");
  return problems;
}

export async function savePartner(actor: Actor, raw: PartnerInput) {
  assertCan(actor, "partners.manage");
  const input = partnerSchema.parse(raw);
  const problems = validatePartnerConfig(input);
  if (problems.length) throw new ValidationError(problems.join(" "), "partner_config_invalid");
  const { id, ...values } = input;
  try {
    return await db.transaction(async (tx) => {
      const [row] = id
        ? await tx.update(partnerServices).set({ ...values, updatedAt: new Date() }).where(eq(partnerServices.id, id)).returning()
        : await tx.insert(partnerServices).values(values).returning();
      if (!row) throw new NotFoundError("Partner service");
      await audit(tx, { actorUserId: actor.userId, action: id ? "partner.updated" : "partner.created", entityType: "partner_service", entityId: row.id, data: { slug: row.slug, status: row.status, approvedDomains: row.approvedDomains } });
      return row;
    });
  } catch (e) {
    if (pgErrorCode(e) === PG_UNIQUE_VIOLATION) throw new ConflictError("Another partner service already uses that slug.");
    throw e;
  }
}

/* ------------------------------ Visibility ------------------------------ */

async function viewerContext(actor: Actor | null, tx: DbOrTx) {
  if (!actor) return { signedIn: false, planCode: null as string | null, staff: false };
  const m = actor.personId ? await activeMembershipFor(tx, actor.personId) : null;
  return { signedIn: true, planCode: m?.planCode ?? null, staff: can(actor, "partners.manage") };
}

function isVisible(v: PartnerVisibility, ctx: { planCode: string | null }) {
  if (v.audience === "public") return true;
  if (v.audience === "members") return ctx.planCode !== null;
  return ctx.planCode !== null && (v.planCodes ?? []).includes(ctx.planCode);
}

/** What a member may see about a partner: no internal configuration, only launchable actions. */
export type PartnerCard = {
  slug: string;
  name: string;
  description: string;
  logoUrl: string | null;
  category: string;
  /** False when the partner is unconfigured/unavailable: show a fallback, never a dead button. */
  available: boolean;
  unavailableReason: string | null;
  launchTarget: "new_tab" | "same_tab";
  actions: { kind: LinkKind; label: string; host: string }[];
  /** Honest description of what the connection does. */
  connectionNote: string;
};

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

function toCard(p: Partner): PartnerCard {
  const problems = validatePartnerConfig(p);
  const available = p.status === "active" && problems.length === 0;
  const actions: PartnerCard["actions"] = [];
  if (available) {
    if (p.bookingUrl) actions.push({ kind: "booking", label: p.bookingLabel ?? `Book ${p.name}`, host: hostOf(p.bookingUrl) });
    if (p.accountUrl) actions.push({ kind: "account", label: p.accountLabel ?? "Open Account", host: hostOf(p.accountUrl) });
    if (p.supportUrl) actions.push({ kind: "support", label: "Get Help", host: hostOf(p.supportUrl) });
  }
  return {
    slug: p.slug,
    name: p.name,
    description: p.description,
    logoUrl: p.logoUrl,
    category: p.category,
    available,
    unavailableReason: available ? null : p.status === "unavailable" ? "This partner service is temporarily unavailable." : "This service is not set up yet. Please ask the front desk for help.",
    launchTarget: p.launchTarget,
    actions,
    connectionNote:
      "Opens the partner's own website. Appointments, payments and records there are managed by the partner; they are not confirmed by or stored in your AAC account. You may need to sign in with the partner separately.",
  };
}

export async function listPartnerCards(actor: Actor | null, tx: DbOrTx = db): Promise<PartnerCard[]> {
  const ctx = await viewerContext(actor, tx);
  const rows = await tx.select().from(partnerServices).orderBy(asc(partnerServices.displayOrder), asc(partnerServices.name));
  return rows.filter((p) => p.status !== "disabled" && isVisible(p.visibility, ctx)).map(toCard);
}

export async function getPartnerCard(actor: Actor | null, slug: string, tx: DbOrTx = db): Promise<PartnerCard> {
  const ctx = await viewerContext(actor, tx);
  const [p] = await tx.select().from(partnerServices).where(eq(partnerServices.slug, slug));
  // Hidden partners are indistinguishable from non-existent ones.
  if (!p || p.status === "disabled" || !isVisible(p.visibility, ctx)) throw new NotFoundError("Service");
  return toCard(p);
}

/* -------------------------------- Launch -------------------------------- */

/**
 * Resolve a partner launch. The destination comes only from stored configuration (never from
 * the request), is re-validated against the approved domains at launch time, and carries no
 * member data. The recorded event is a click-through, not an appointment or a payment.
 */
export async function resolvePartnerLaunch(actor: Actor | null, slug: string, kind: LinkKind): Promise<{ url: string; partnerName: string }> {
  const ctx = await viewerContext(actor, db);
  const [p] = await db.select().from(partnerServices).where(eq(partnerServices.slug, slug));
  if (!p || p.status === "disabled" || !isVisible(p.visibility, ctx)) throw new NotFoundError("Service");
  if (p.status !== "active") throw new AppError("partner_unavailable", "This partner service is not available right now.", 409);
  let url = kind === "booking" ? p.bookingUrl : kind === "account" ? p.accountUrl : p.supportUrl;
  if (kind === "booking" && p.connectionMode === "deep_link" && p.deepLinkUrl && !partnerUrlProblem(p.deepLinkUrl, p.approvedDomains)) url = p.deepLinkUrl;
  if (!url) throw new AppError("partner_unavailable", "This partner link is not configured.", 409);
  if (partnerUrlProblem(url, p.approvedDomains)) throw new AppError("partner_unavailable", "This partner link failed safety validation.", 409);
  await db.insert(partnerLaunchEvents).values({
    partnerServiceId: p.id,
    // Clinical partners: do not record which member launched, so no health inference is stored.
    personId: p.handlesHealthInfo ? null : (actor?.personId ?? null),
    linkKind: kind,
  });
  return { url, partnerName: p.name };
}

/* -------------------------------- Admin --------------------------------- */

export async function listPartnersAdmin(actor: Actor) {
  assertCan(actor, "partners.manage");
  const rows = await db.select().from(partnerServices).orderBy(asc(partnerServices.displayOrder), asc(partnerServices.name));
  return rows.map((p) => ({ partner: p, problems: validatePartnerConfig(p) }));
}

export async function getPartnerAdmin(actor: Actor, id: string) {
  assertCan(actor, "partners.manage");
  const [p] = await db.select().from(partnerServices).where(eq(partnerServices.id, id));
  if (!p) throw new NotFoundError("Partner service");
  return p;
}
