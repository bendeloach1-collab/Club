-- Hand-written constraints that Drizzle's schema DSL cannot express.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS member_number_seq START 100001;
--> statement-breakpoint
-- A physical resource can never hold two overlapping time claims, regardless of
-- how many requests race. [start, end) so back-to-back reservations are allowed.
ALTER TABLE resource_reservations
  ADD CONSTRAINT resource_reservations_no_overlap
  EXCLUDE USING gist (resource_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&);
--> statement-breakpoint
ALTER TABLE resource_reservations ADD CONSTRAINT resource_reservations_valid_range CHECK (ends_at > starts_at);
--> statement-breakpoint
ALTER TABLE sessions ADD CONSTRAINT sessions_valid_range CHECK (ends_at > starts_at);
--> statement-breakpoint
ALTER TABLE sessions ADD CONSTRAINT sessions_capacity_positive CHECK (capacity > 0);
--> statement-breakpoint
ALTER TABLE payments ADD CONSTRAINT payments_amount_positive CHECK (amount_cents > 0);
--> statement-breakpoint
ALTER TABLE payments ADD CONSTRAINT payments_refund_bounds CHECK (refunded_cents >= 0 AND refunded_cents <= amount_cents);
--> statement-breakpoint
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_amount_nonzero CHECK (amount_cents <> 0);
--> statement-breakpoint
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_reverses_fk FOREIGN KEY (reverses_entry_id) REFERENCES ledger_entries(id);
--> statement-breakpoint
-- Posted ledger entries are immutable. Corrections are explicit reversal entries.
CREATE OR REPLACE FUNCTION ledger_entries_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries are immutable; post a reversal instead';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_update BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_immutable();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_entries_immutable();
--> statement-breakpoint
-- Audit log is append-only.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
