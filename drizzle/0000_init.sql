CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"household_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"charge_enabled" boolean DEFAULT false NOT NULL,
	"credit_limit_cents" integer DEFAULT 0 NOT NULL,
	"provider_customer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_accounts_household_id_unique" UNIQUE("household_id")
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"session_id" uuid,
	"person_id" uuid NOT NULL,
	"booked_by_person_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"status" text NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"terms" jsonb NOT NULL,
	"payment_method" text NOT NULL,
	"payment_id" uuid,
	"hold_expires_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"staff_user_id" text NOT NULL,
	"result" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid,
	"lead_id" uuid,
	"channel" text NOT NULL,
	"granted" boolean NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"accepted_by_person_id" uuid NOT NULL,
	"membership_id" uuid,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guardianships" (
	"guardian_person_id" uuid NOT NULL,
	"child_person_id" uuid NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guardianships_guardian_person_id_child_person_id_pk" PRIMARY KEY("guardian_person_id","child_person_id")
);
--> statement-breakpoint
CREATE TABLE "household_members" (
	"household_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text NOT NULL,
	"can_book_for_household" boolean DEFAULT false NOT NULL,
	"can_manage_billing" boolean DEFAULT false NOT NULL,
	"can_charge_account" boolean DEFAULT false NOT NULL,
	"charge_limit_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_members_household_id_person_id_pk" PRIMARY KEY("household_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"type" text NOT NULL,
	"body" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"title" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"assigned_to_user_id" text,
	"completed_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"email_normalized" text,
	"phone" text,
	"phone_normalized" text,
	"interest" text,
	"source" text DEFAULT 'website' NOT NULL,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"stage" text DEFAULT 'new' NOT NULL,
	"lost_reason" text,
	"assigned_to_user_id" text,
	"person_id" uuid,
	"converted_membership_id" uuid,
	"converted_at" timestamp with time zone,
	"marketing_email_opt_in" boolean DEFAULT false NOT NULL,
	"marketing_sms_opt_in" boolean DEFAULT false NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"entry_type" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"person_id" uuid,
	"source_type" text,
	"source_id" text,
	"payment_id" uuid,
	"reverses_entry_id" uuid,
	"idempotency_key" text NOT NULL,
	"created_by_user_id" text,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "membership_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"type" text NOT NULL,
	"effective_date" date NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"applied_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_members" (
	"membership_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_members_membership_id_person_id_pk" PRIMARY KEY("membership_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "membership_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"benefits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dues_cents" integer NOT NULL,
	"enrollment_fee_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"billing_interval" text DEFAULT 'month' NOT NULL,
	"max_adults" integer DEFAULT 1 NOT NULL,
	"max_dependents" integer DEFAULT 0 NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_plans_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"status" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"dues_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"next_billing_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_launch_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_service_id" uuid NOT NULL,
	"person_id" uuid,
	"link_kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"logo_url" text,
	"category" text DEFAULT 'wellness' NOT NULL,
	"connection_mode" text DEFAULT 'link' NOT NULL,
	"approved_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"booking_url" text,
	"booking_label" text,
	"account_url" text,
	"account_label" text,
	"support_url" text,
	"deep_link_url" text,
	"visibility" jsonb DEFAULT '{"audience":"members"}'::jsonb NOT NULL,
	"launch_target" text DEFAULT 'new_tab' NOT NULL,
	"status" text DEFAULT 'unconfigured' NOT NULL,
	"handles_health_info" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_services_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text NOT NULL,
	"provider_checkout_id" text,
	"provider_payment_id" text,
	"checkout_url" text,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "payments_provider_checkout_id_unique" UNIQUE("provider_checkout_id"),
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"email_normalized" text,
	"phone" text,
	"phone_normalized" text,
	"date_of_birth" date,
	"member_number" text NOT NULL,
	"marketing_email_opt_in" boolean DEFAULT false NOT NULL,
	"marketing_sms_opt_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persons_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "persons_member_number_unique" UNIQUE("member_number")
);
--> statement-breakpoint
CREATE TABLE "resource_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"session_id" uuid,
	"booking_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sandbox_checkouts" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_intent_id" text NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"success_url" text NOT NULL,
	"cancel_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"booking_mode" text DEFAULT 'native' NOT NULL,
	"partner_service_id" uuid,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"default_capacity" integer DEFAULT 1 NOT NULL,
	"member_price_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"requires_membership" boolean DEFAULT true NOT NULL,
	"booking_window_days" integer DEFAULT 14 NOT NULL,
	"cancel_window_hours" integer DEFAULT 12 NOT NULL,
	"late_cancel_fee_cents" integer DEFAULT 0 NOT NULL,
	"no_show_fee_cents" integer DEFAULT 0 NOT NULL,
	"policy_version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"coach_user_id" text,
	"resource_id" uuid,
	"location" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_roles" (
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
CREATE TABLE "tours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"staff_user_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_booked_by_person_id_persons_id_fk" FOREIGN KEY ("booked_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_staff_user_id_user_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acceptances" ADD CONSTRAINT "document_acceptances_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acceptances" ADD CONSTRAINT "document_acceptances_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acceptances" ADD CONSTRAINT "document_acceptances_accepted_by_person_id_persons_id_fk" FOREIGN KEY ("accepted_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acceptances" ADD CONSTRAINT "document_acceptances_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardianships" ADD CONSTRAINT "guardianships_guardian_person_id_persons_id_fk" FOREIGN KEY ("guardian_person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardianships" ADD CONSTRAINT "guardianships_child_person_id_persons_id_fk" FOREIGN KEY ("child_person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardianships" ADD CONSTRAINT "guardianships_verified_by_user_id_user_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_assigned_to_user_id_user_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_user_id_user_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_membership_id_memberships_id_fk" FOREIGN KEY ("converted_membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_events" ADD CONSTRAINT "membership_events_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_events" ADD CONSTRAINT "membership_events_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_members" ADD CONSTRAINT "membership_members_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_members" ADD CONSTRAINT "membership_members_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_plan_id_membership_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."membership_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_launch_events" ADD CONSTRAINT "partner_launch_events_partner_service_id_partner_services_id_fk" FOREIGN KEY ("partner_service_id") REFERENCES "public"."partner_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_launch_events" ADD CONSTRAINT "partner_launch_events_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_reservations" ADD CONSTRAINT "resource_reservations_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_reservations" ADD CONSTRAINT "resource_reservations_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_reservations" ADD CONSTRAINT "resource_reservations_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_partner_service_id_partner_services_id_fk" FOREIGN KEY ("partner_service_id") REFERENCES "public"."partner_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_coach_user_id_user_id_fk" FOREIGN KEY ("coach_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tours" ADD CONSTRAINT "tours_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tours" ADD CONSTRAINT "tours_staff_user_id_user_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "bookings_session_idx" ON "bookings" USING btree ("session_id","status");--> statement-breakpoint
CREATE INDEX "bookings_person_idx" ON "bookings" USING btree ("person_id","created_at");--> statement-breakpoint
CREATE INDEX "bookings_household_idx" ON "bookings" USING btree ("household_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_one_live_per_person_session" ON "bookings" USING btree ("session_id","person_id") WHERE status in ('pending_payment','confirmed','attended');--> statement-breakpoint
CREATE INDEX "checkins_person_idx" ON "checkins" USING btree ("person_id","created_at");--> statement-breakpoint
CREATE INDEX "document_acceptances_person_idx" ON "document_acceptances" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_kind_version" ON "documents" USING btree ("kind","version");--> statement-breakpoint
CREATE INDEX "household_members_person_idx" ON "household_members" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "lead_activities_lead_idx" ON "lead_activities" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_tasks_due_idx" ON "lead_tasks" USING btree ("completed_at","due_at");--> statement-breakpoint
CREATE INDEX "leads_stage_idx" ON "leads" USING btree ("stage","last_activity_at");--> statement-breakpoint
CREATE INDEX "leads_email_idx" ON "leads" USING btree ("email_normalized");--> statement-breakpoint
CREATE INDEX "leads_phone_idx" ON "leads" USING btree ("phone_normalized");--> statement-breakpoint
CREATE INDEX "leads_assigned_idx" ON "leads" USING btree ("assigned_to_user_id");--> statement-breakpoint
CREATE INDEX "ledger_account_posted_idx" ON "ledger_entries" USING btree ("billing_account_id","posted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_single_reversal" ON "ledger_entries" USING btree ("reverses_entry_id") WHERE reverses_entry_id is not null;--> statement-breakpoint
CREATE INDEX "membership_events_membership_idx" ON "membership_events" USING btree ("membership_id","effective_date");--> statement-breakpoint
CREATE INDEX "membership_members_person_idx" ON "membership_members" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "memberships_household_idx" ON "memberships" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_one_live_per_household" ON "memberships" USING btree ("household_id") WHERE status in ('pending_payment','active','frozen');--> statement-breakpoint
CREATE INDEX "partner_launch_partner_idx" ON "partner_launch_events" USING btree ("partner_service_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_account_idx" ON "payments" USING btree ("billing_account_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_provider_payment_idx" ON "payments" USING btree ("provider_payment_id");--> statement-breakpoint
CREATE INDEX "persons_email_idx" ON "persons" USING btree ("email_normalized");--> statement-breakpoint
CREATE INDEX "persons_phone_idx" ON "persons" USING btree ("phone_normalized");--> statement-breakpoint
CREATE INDEX "persons_name_idx" ON "persons" USING btree ("last_name","first_name");--> statement-breakpoint
CREATE INDEX "resource_reservations_resource_idx" ON "resource_reservations" USING btree ("resource_id","starts_at");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_starts_idx" ON "sessions" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "sessions_service_idx" ON "sessions" USING btree ("service_id","starts_at");--> statement-breakpoint
CREATE INDEX "tours_scheduled_idx" ON "tours" USING btree ("scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tours_slot_unique" ON "tours" USING btree ("scheduled_at") WHERE status = 'scheduled';--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_event" ON "webhook_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "webhook_events_status_idx" ON "webhook_events" USING btree ("status");