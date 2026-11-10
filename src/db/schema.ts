/**
 * AAC Club OS database schema.
 *
 * Conventions
 * - Money: integer minor units (`*_cents`) + ISO currency code. Never floats.
 * - Time: `timestamptz` everywhere; club-local rendering uses America/New_York.
 * - Enumerations are `text` columns typed in TypeScript and validated with zod at the
 *   boundary, so new values do not require enum migrations.
 * - Constraints that Drizzle cannot express (exclusion constraints, immutability
 *   triggers) live in the hand-written migration `drizzle/0001_constraints.sql`.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

/* -------------------------------------------------------------------------- */
/* Authentication (managed by Better Auth)                                     */
/* -------------------------------------------------------------------------- */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: ts("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const STAFF_ROLES = ["sales", "front_desk", "coach", "kids_club", "manager", "finance", "admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const staffRoles = pgTable(
  "staff_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: STAFF_ROLES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

/* -------------------------------------------------------------------------- */
/* Identity: people and households                                             */
/* -------------------------------------------------------------------------- */

export const persons = pgTable(
  "persons",
  {
    id: id(),
    /** Login for this person. Each adult may have their own; dependents normally have none. */
    userId: text("user_id")
      .unique()
      .references(() => user.id, { onDelete: "set null" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    emailNormalized: text("email_normalized"),
    phone: text("phone"),
    phoneNormalized: text("phone_normalized"),
    dateOfBirth: date("date_of_birth"),
    /** Digital member ID shown on the member card and used at the front desk. */
    memberNumber: text("member_number").notNull().unique(),
    /** Marketing consent is tracked separately from operational notifications. */
    marketingEmailOptIn: boolean("marketing_email_opt_in").notNull().default(false),
    marketingSmsOptIn: boolean("marketing_sms_opt_in").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("persons_email_idx").on(t.emailNormalized),
    index("persons_phone_idx").on(t.phoneNormalized),
    index("persons_name_idx").on(t.lastName, t.firstName),
  ],
);

export const households = pgTable("households", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const HOUSEHOLD_ROLES = ["primary", "adult", "dependent"] as const;

export const householdMembers = pgTable(
  "household_members",
  {
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    role: text("role", { enum: HOUSEHOLD_ROLES }).notNull(),
    /** May create/cancel bookings for other household members. */
    canBookForHousehold: boolean("can_book_for_household").notNull().default(false),
    /** May view statements, pay balances and manage payment methods. */
    canManageBilling: boolean("can_manage_billing").notNull().default(false),
    /** May use "Charge to Club Account". */
    canChargeAccount: boolean("can_charge_account").notNull().default(false),
    /** Optional per-person cap on a single club-account charge. */
    chargeLimitCents: integer("charge_limit_cents"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.personId] }), index("household_members_person_idx").on(t.personId)],
);

/** Guardian authority is explicit and never inferred from household membership. */
export const guardianships = pgTable(
  "guardianships",
  {
    guardianPersonId: uuid("guardian_person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    childPersonId: uuid("child_person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    /** Set when staff have verified the relationship. */
    verifiedAt: ts("verified_at"),
    verifiedByUserId: text("verified_by_user_id").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.guardianPersonId, t.childPersonId] })],
);

/* -------------------------------------------------------------------------- */
/* Memberships                                                                 */
/* -------------------------------------------------------------------------- */

export const PLAN_TYPES = ["individual", "couple", "family", "corporate"] as const;

export const membershipPlans = pgTable("membership_plans", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  type: text("type", { enum: PLAN_TYPES }).notNull(),
  description: text("description").notNull().default(""),
  benefits: jsonb("benefits").$type<string[]>().notNull().default([]),
  duesCents: integer("dues_cents").notNull(),
  enrollmentFeeCents: integer("enrollment_fee_cents").notNull().default(0),
  currency: text("currency").notNull().default("usd"),
  billingInterval: text("billing_interval", { enum: ["month", "year"] }).notNull().default("month"),
  maxAdults: integer("max_adults").notNull().default(1),
  maxDependents: integer("max_dependents").notNull().default(0),
  isPublic: boolean("is_public").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const MEMBERSHIP_STATUSES = ["pending_payment", "active", "frozen", "cancelled", "expired"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    planId: uuid("plan_id")
      .notNull()
      .references(() => membershipPlans.id),
    billingAccountId: uuid("billing_account_id")
      .notNull()
      .references(() => billingAccounts.id),
    status: text("status", { enum: MEMBERSHIP_STATUSES }).notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    /** Price accepted at enrollment; plan price changes do not silently alter it. */
    duesCents: integer("dues_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    /** Next date AAC's own billing scheduler will raise dues (Milestone 2). */
    nextBillingDate: date("next_billing_date"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("memberships_household_idx").on(t.householdId),
    // A household can hold at most one live membership at a time.
    uniqueIndex("memberships_one_live_per_household")
      .on(t.householdId)
      .where(sql`status in ('pending_payment','active','frozen')`),
  ],
);

export const membershipMembers = pgTable(
  "membership_members",
  {
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.personId] }), index("membership_members_person_idx").on(t.personId)],
);

/** Effective-dated history of everything that happens to a membership. */
export const membershipEvents = pgTable(
  "membership_events",
  {
    id: id(),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    effectiveDate: date("effective_date").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    /** Null while a future-dated change is still pending. */
    appliedAt: ts("applied_at"),
    createdByUserId: text("created_by_user_id").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("membership_events_membership_idx").on(t.membershipId, t.effectiveDate)],
);

export const documents = pgTable(
  "documents",
  {
    id: id(),
    kind: text("kind", { enum: ["membership_agreement", "liability_waiver"] }).notNull(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    isCurrent: boolean("is_current").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("documents_kind_version").on(t.kind, t.version)],
);

export const documentAcceptances = pgTable(
  "document_acceptances",
  {
    id: id(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    /** Person the document applies to. */
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    /** Adult who accepted (the person themself, or a guardian for a dependent). */
    acceptedByPersonId: uuid("accepted_by_person_id")
      .notNull()
      .references(() => persons.id),
    membershipId: uuid("membership_id").references(() => memberships.id),
    acceptedAt: ts("accepted_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
  },
  (t) => [index("document_acceptances_person_idx").on(t.personId)],
);

export const checkins = pgTable(
  "checkins",
  {
    id: id(),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    staffUserId: text("staff_user_id")
      .notNull()
      .references(() => user.id),
    result: text("result", { enum: ["allowed", "denied"] }).notNull(),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [index("checkins_person_idx").on(t.personId, t.createdAt)],
);

/* -------------------------------------------------------------------------- */
/* Billing: club accounts, ledger, payments                                    */
/* -------------------------------------------------------------------------- */

export const billingAccounts = pgTable("billing_accounts", {
  id: id(),
  householdId: uuid("household_id")
    .notNull()
    .unique()
    .references(() => households.id),
  currency: text("currency").notNull().default("usd"),
  status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
  /** Whether "Charge to Club Account" is enabled at all for this account. */
  chargeEnabled: boolean("charge_enabled").notNull().default(false),
  /** Maximum outstanding balance allowed when charging to the account. */
  creditLimitCents: integer("credit_limit_cents").notNull().default(0),
  /** Processor customer reference. No card or bank details are ever stored. */
  providerCustomerId: text("provider_customer_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const LEDGER_ENTRY_TYPES = ["charge", "payment", "credit", "refund", "reversal"] as const;

/**
 * Club-account ledger. Rows are immutable once posted (enforced by trigger);
 * corrections are made with explicit reversal entries.
 * Sign convention: positive = amount owed to AAC increases, negative = decreases.
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: id(),
    billingAccountId: uuid("billing_account_id")
      .notNull()
      .references(() => billingAccounts.id),
    entryType: text("entry_type", { enum: LEDGER_ENTRY_TYPES }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    /** Who incurred the entry, when attributable to a household member. */
    personId: uuid("person_id").references(() => persons.id),
    sourceType: text("source_type"),
    sourceId: text("source_id"),
    paymentId: uuid("payment_id").references(() => payments.id),
    reversesEntryId: uuid("reverses_entry_id"),
    /** Guarantees a business event posts at most once. */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdByUserId: text("created_by_user_id").references(() => user.id),
    postedAt: ts("posted_at").notNull().defaultNow(),
  },
  (t) => [
    index("ledger_account_posted_idx").on(t.billingAccountId, t.postedAt),
    uniqueIndex("ledger_single_reversal").on(t.reversesEntryId).where(sql`reverses_entry_id is not null`),
  ],
);

export const PAYMENT_STATUSES = [
  "pending", // created, customer has not completed checkout
  "requires_action", // customer authentication outstanding
  "processing", // delayed method (e.g. bank debit) submitted, not yet settled
  "succeeded",
  "failed",
  "canceled",
  "partially_refunded",
  "refunded",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type PaymentLineItem = {
  description: string;
  amountCents: number;
  category: string;
  sourceType?: string;
  sourceId?: string;
  personId?: string;
};

export const payments = pgTable(
  "payments",
  {
    id: id(),
    billingAccountId: uuid("billing_account_id")
      .notNull()
      .references(() => billingAccounts.id),
    purpose: text("purpose", { enum: ["enrollment", "booking", "account_payment", "package"] }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    status: text("status", { enum: PAYMENT_STATUSES }).notNull().default("pending"),
    provider: text("provider").notNull(),
    providerCheckoutId: text("provider_checkout_id").unique(),
    providerPaymentId: text("provider_payment_id"),
    checkoutUrl: text("checkout_url"),
    refundedCents: integer("refunded_cents").notNull().default(0),
    failureReason: text("failure_reason"),
    lineItems: jsonb("line_items").$type<PaymentLineItem[]>().notNull().default([]),
    /** One charge-producing request maps to exactly one payment. */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdByUserId: text("created_by_user_id").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    settledAt: ts("settled_at"),
  },
  (t) => [
    index("payments_account_idx").on(t.billingAccountId, t.createdAt),
    index("payments_provider_payment_idx").on(t.providerPaymentId),
  ],
);

/** Every verified processor webhook, stored once, for idempotency and failed-event review. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status", { enum: ["received", "processed", "ignored", "failed"] }).notNull().default("received"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    receivedAt: ts("received_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
  },
  (t) => [uniqueIndex("webhook_events_provider_event").on(t.provider, t.eventId), index("webhook_events_status_idx").on(t.status)],
);

/** State for the built-in SANDBOX payment processor (development/demo only). */
export const sandboxCheckouts = pgTable("sandbox_checkouts", {
  id: text("id").primaryKey(),
  paymentIntentId: text("payment_intent_id").notNull(),
  paymentId: uuid("payment_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull(),
  description: text("description").notNull(),
  status: text("status", { enum: ["open", "complete", "expired"] }).notNull().default("open"),
  paymentStatus: text("payment_status", { enum: ["unpaid", "processing", "paid", "failed"] }).notNull().default("unpaid"),
  refundedCents: integer("refunded_cents").notNull().default(0),
  successUrl: text("success_url").notNull(),
  cancelUrl: text("cancel_url").notNull(),
  createdAt: createdAt(),
});

/* -------------------------------------------------------------------------- */
/* CRM                                                                         */
/* -------------------------------------------------------------------------- */

export const LEAD_STAGES = ["new", "contacted", "tour_scheduled", "toured", "proposal", "won", "lost"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const leads = pgTable(
  "leads",
  {
    id: id(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    emailNormalized: text("email_normalized"),
    phone: text("phone"),
    phoneNormalized: text("phone_normalized"),
    interest: text("interest"),
    source: text("source").notNull().default("website"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    stage: text("stage", { enum: LEAD_STAGES }).notNull().default("new"),
    lostReason: text("lost_reason"),
    assignedToUserId: text("assigned_to_user_id").references(() => user.id),
    /** Set on conversion; the lead and its history stay attached to the member. */
    personId: uuid("person_id").references(() => persons.id),
    convertedMembershipId: uuid("converted_membership_id").references(() => memberships.id),
    convertedAt: ts("converted_at"),
    marketingEmailOptIn: boolean("marketing_email_opt_in").notNull().default(false),
    marketingSmsOptIn: boolean("marketing_sms_opt_in").notNull().default(false),
    lastActivityAt: ts("last_activity_at").notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("leads_stage_idx").on(t.stage, t.lastActivityAt),
    index("leads_email_idx").on(t.emailNormalized),
    index("leads_phone_idx").on(t.phoneNormalized),
    index("leads_assigned_idx").on(t.assignedToUserId),
  ],
);

export const leadActivities = pgTable(
  "lead_activities",
  {
    id: id(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["inquiry", "note", "call", "email", "sms", "stage_change", "tour", "system"] }).notNull(),
    body: text("body").notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("lead_activities_lead_idx").on(t.leadId, t.createdAt)],
);

export const leadTasks = pgTable(
  "lead_tasks",
  {
    id: id(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    dueAt: ts("due_at").notNull(),
    assignedToUserId: text("assigned_to_user_id").references(() => user.id),
    completedAt: ts("completed_at"),
    createdByUserId: text("created_by_user_id").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("lead_tasks_due_idx").on(t.completedAt, t.dueAt)],
);

export const tours = pgTable(
  "tours",
  {
    id: id(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    scheduledAt: ts("scheduled_at").notNull(),
    status: text("status", { enum: ["scheduled", "completed", "no_show", "cancelled"] }).notNull().default("scheduled"),
    staffUserId: text("staff_user_id").references(() => user.id),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [
    index("tours_scheduled_idx").on(t.scheduledAt),
    // One tour per start time keeps the public tour scheduler from double-booking a slot.
    uniqueIndex("tours_slot_unique").on(t.scheduledAt).where(sql`status = 'scheduled'`),
  ],
);

/** Append-only history of marketing consent changes (separate from operational messaging). */
export const consentEvents = pgTable("consent_events", {
  id: id(),
  personId: uuid("person_id").references(() => persons.id),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  channel: text("channel", { enum: ["email", "sms"] }).notNull(),
  granted: boolean("granted").notNull(),
  source: text("source").notNull(),
  createdAt: createdAt(),
});

/* -------------------------------------------------------------------------- */
/* Partner services                                                            */
/* -------------------------------------------------------------------------- */

export const PARTNER_MODES = ["link", "deep_link", "sso", "api"] as const;
export const PARTNER_STATUSES = ["active", "unconfigured", "unavailable", "disabled"] as const;
export type PartnerVisibility = { audience: "public" | "members" | "plans"; planCodes?: string[] };

export const partnerServices = pgTable("partner_services", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  logoUrl: text("logo_url"),
  category: text("category").notNull().default("wellness"),
  connectionMode: text("connection_mode", { enum: PARTNER_MODES }).notNull().default("link"),
  /** Hostnames a launch may redirect to. Sub-domains are allowed only when listed as `*.example.com`. */
  approvedDomains: jsonb("approved_domains").$type<string[]>().notNull().default([]),
  bookingUrl: text("booking_url"),
  bookingLabel: text("booking_label"),
  accountUrl: text("account_url"),
  accountLabel: text("account_label"),
  supportUrl: text("support_url"),
  /** Optional officially supported app deep link; `bookingUrl` is the web fallback. */
  deepLinkUrl: text("deep_link_url"),
  visibility: jsonb("visibility").$type<PartnerVisibility>().notNull().default({ audience: "members" }),
  launchTarget: text("launch_target", { enum: ["new_tab", "same_tab"] }).notNull().default("new_tab"),
  status: text("status", { enum: PARTNER_STATUSES }).notNull().default("unconfigured"),
  /** Clinical partners: launches are never forwarded to analytics/marketing. */
  handlesHealthInfo: boolean("handles_health_info").notNull().default(false),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** A launch is only a click-through. It never represents a confirmed appointment or payment. */
export const partnerLaunchEvents = pgTable(
  "partner_launch_events",
  {
    id: id(),
    partnerServiceId: uuid("partner_service_id")
      .notNull()
      .references(() => partnerServices.id, { onDelete: "cascade" }),
    personId: uuid("person_id").references(() => persons.id),
    linkKind: text("link_kind", { enum: ["booking", "account", "support"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("partner_launch_partner_idx").on(t.partnerServiceId, t.createdAt)],
);

/* -------------------------------------------------------------------------- */
/* Scheduling and bookings                                                     */
/* -------------------------------------------------------------------------- */

export const SERVICE_CATEGORIES = [
  "class",
  "performance",
  "personal_training",
  "semi_private",
  "court",
  "golf",
  "camp",
  "event",
] as const;

export const services = pgTable("services", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  category: text("category", { enum: SERVICE_CATEGORIES }).notNull(),
  description: text("description").notNull().default(""),
  /** `native` = booked and confirmed by AAC. `partner` = launched via a partner service. */
  bookingMode: text("booking_mode", { enum: ["native", "partner"] }).notNull().default("native"),
  partnerServiceId: uuid("partner_service_id").references(() => partnerServices.id),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  defaultCapacity: integer("default_capacity").notNull().default(1),
  memberPriceCents: integer("member_price_cents").notNull().default(0),
  currency: text("currency").notNull().default("usd"),
  requiresMembership: boolean("requires_membership").notNull().default(true),
  /** How far ahead members may book. */
  bookingWindowDays: integer("booking_window_days").notNull().default(14),
  /** Free cancellation is allowed until this many hours before start. */
  cancelWindowHours: integer("cancel_window_hours").notNull().default(12),
  lateCancelFeeCents: integer("late_cancel_fee_cents").notNull().default(0),
  noShowFeeCents: integer("no_show_fee_cents").notNull().default(0),
  /** Incremented whenever price or policy changes; snapshotted on each booking. */
  policyVersion: integer("policy_version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const resources = pgTable("resources", {
  id: id(),
  name: text("name").notNull(),
  type: text("type", { enum: ["court", "golf_bay", "studio", "room", "field"] }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    capacity: integer("capacity").notNull(),
    coachUserId: text("coach_user_id").references(() => user.id),
    resourceId: uuid("resource_id").references(() => resources.id),
    location: text("location"),
    status: text("status", { enum: ["scheduled", "cancelled"] }).notNull().default("scheduled"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_starts_idx").on(t.startsAt), index("sessions_service_idx").on(t.serviceId, t.startsAt)],
);

export const BOOKING_STATUSES = ["pending_payment", "confirmed", "cancelled", "expired", "attended", "no_show"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Exactly what the member was shown and accepted before confirming. */
export type BookingTerms = {
  policyVersion: number;
  priceCents: number;
  currency: string;
  cancelWindowHours: number;
  lateCancelFeeCents: number;
  noShowFeeCents: number;
  summary: string;
};

export const bookings = pgTable(
  "bookings",
  {
    id: id(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id),
    sessionId: uuid("session_id").references(() => sessions.id),
    /** Participant. */
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    /** Adult who made the booking (may differ from the participant). */
    bookedByPersonId: uuid("booked_by_person_id")
      .notNull()
      .references(() => persons.id),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    status: text("status", { enum: BOOKING_STATUSES }).notNull(),
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").notNull(),
    terms: jsonb("terms").$type<BookingTerms>().notNull(),
    paymentMethod: text("payment_method", { enum: ["included", "pay_now", "club_account"] }).notNull(),
    paymentId: uuid("payment_id").references(() => payments.id),
    /** Seats held for unpaid "Pay Now" bookings are released after this time. */
    holdExpiresAt: ts("hold_expires_at"),
    cancelledAt: ts("cancelled_at"),
    cancelReason: text("cancel_reason"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("bookings_session_idx").on(t.sessionId, t.status),
    index("bookings_person_idx").on(t.personId, t.createdAt),
    index("bookings_household_idx").on(t.householdId, t.createdAt),
    // A person can hold one live booking per session.
    uniqueIndex("bookings_one_live_per_person_session")
      .on(t.sessionId, t.personId)
      .where(sql`status in ('pending_payment','confirmed','attended')`),
  ],
);

/**
 * Time claims on a physical resource (class sessions, direct reservations, maintenance).
 * An exclusion constraint in 0001_constraints.sql makes overlapping claims impossible.
 */
export const resourceReservations = pgTable(
  "resource_reservations",
  {
    id: id(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    kind: text("kind", { enum: ["session", "booking", "maintenance"] }).notNull(),
    sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("resource_reservations_resource_idx").on(t.resourceId, t.startsAt)],
);

/* -------------------------------------------------------------------------- */
/* Audit                                                                       */
/* -------------------------------------------------------------------------- */

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    householdId: uuid("household_id"),
    /** Never store secrets, card data or clinical information here. */
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_created_idx").on(t.createdAt)],
);

/** Runtime-configurable club policies (key/value), editable by administrators. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});
