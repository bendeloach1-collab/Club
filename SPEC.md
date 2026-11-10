# AAC Club OS — specification

Web platform for Athens Athletic Club covering membership, CRM, scheduling and bookings,
billing records and club accounts, and partner services. AAC Club OS is the authoritative
system for memberships, household relationships, privileges, native bookings and the
club-account ledger. Scope by milestone and current status: IMPLEMENTATION_PLAN.md.

## 1. Experiences

- **Public** (`/`): plans, enrollment, inquiry, tour scheduling, class schedule, sign-in.
- **Member portal** (`/portal`): Home, Book, My Schedule, Family, Services, Account.
- **Staff console** (`/staff`): Today, Check-in, Leads & tours, Members, Schedule, Billing,
  Reports, Partner services, Integrations, Audit log — shown according to role.

Responsive from 360 px upward; keyboard and screen-reader usable (labelled controls, skip
link, focus styles, status/alert roles); every list has an empty state and every form has
pending, success and error states.

## 2. Domain model

People, households, memberships and billing accounts are separate records.

- **Person** — identity and member number; optionally linked to one login.
- **Household membership** — role (primary, adult, dependent) plus explicit permissions:
  book for household, manage billing, charge to account, per-charge limit.
- **Guardianship** — declared at enrollment, verified by staff; never inferred.
- **Membership** — household + plan + billing account, status
  (pending_payment, active, frozen, cancelled, expired), accepted dues, effective-dated events.
- **Billing account** — one per household; charge enablement, limit, status.
- **Ledger entry** — immutable; charge, payment, credit, refund, reversal; signed integer cents.
- **Payment** — one per charge-producing request; processor references only.
- **Service / session / resource / booking** — modelled separately; a booking stores the
  accepted price and policy.
- **Partner service** — configurable external service; launches recorded as events only.
- **Lead** — own contact fields, linked to a person on conversion.

## 3. Roles

| Role | Can |
| --- | --- |
| sales | CRM, member directory, schedule view, reports |
| front_desk | check-in, member directory, schedule view |
| coach | schedule view; rosters and attendance for own sessions |
| kids_club | schedule view (Kids Club functions arrive in M2) |
| manager | CRM, members (manage), check-in, schedule (manage), billing view, reports, audit |
| finance | billing (view, refunds, account settings), member directory, reports, audit |
| admin | everything, including partner services and integrations |

## 4. Workflows and acceptance criteria

### Enrollment
1. Visitor chooses a plan, enters household, accepts agreement and waiver, sets a password.
2. One transaction creates login, people, household, permissions, billing account,
   pending membership, acceptances and a pending payment.
3. Visitor pays on the hosted checkout. The membership activates only when the processor
   confirms; charges and payment are posted to the ledger.

- ✔ Records are consistent or absent; resubmitting the same form creates nothing new.
- ✔ Plan limits and age rules are enforced on the server.
- ✔ A matching open lead is linked to the new person and marked won on activation, keeping history.
- ✔ A failed or abandoned payment leaves a pending membership that can be retried without double charging.

### CRM
- ✔ Inquiries de-duplicate on normalised email or phone, including simultaneous submissions.
- ✔ Source and campaign attribution, assignment, first follow-up task, consent recorded per channel.
- ✔ Tour slots cannot be double-booked. Public responses never reveal existing contacts.
- ✔ "Won" can only result from an activated membership.

### Booking
1. Member picks a session and participant; sees price, cancellation terms, availability and payment options.
2. Confirm: included, Pay Now (seat held 15 minutes pending payment), or Charge to Club Account.

- ✔ Capacity can never be exceeded and a person cannot hold two places, under concurrency.
- ✔ A resource cannot hold overlapping claims (sessions, reservations, maintenance).
- ✔ Eligibility (active membership, booking window, household permission) is checked in the transaction.
- ✔ The accepted price and policy version are stored; stale terms are rejected.
- ✔ Timely cancellation reverses or refunds; late cancellation follows the stored terms.
- ✔ Partner-managed services cannot be booked natively and never appear as AAC bookings.

### Payments and club account
- ✔ Webhook signatures verified on the raw body; each event stored once; duplicates and reordering converge.
- ✔ Retried requests map to one payment and one checkout (idempotency keys end to end).
- ✔ Payment status is taken from the processor server-side, never from the return redirect.
- ✔ Pending, failed, cancelled, delayed and refunded outcomes leave consistent bookings, memberships and ledger.
- ✔ Club-account charges need explicit permission, an enabled active account, and stay within
  limits under concurrency.
- ✔ Ledger entries cannot be updated or deleted; a reversal can be posted once.

### Partner services
- ✔ Administrators add and edit partners without code changes.
- ✔ URLs must be HTTPS on an approved domain with no credentials or personal data in them;
  validated on save and again at launch.
- ✔ Visibility (public, members, selected plans) is enforced for listing, detail and launch.
- ✔ Launch destination comes only from configuration (no open redirect); no member data is sent.
- ✔ A launch records only a click event — for clinical partners without the member's identity.
- ✔ Unconfigured or unavailable partners show a fallback, never a success message.

### Access control
- ✔ Members cannot read or change another household's people, bookings, payments or ledger.
- ✔ Staff functions are rejected for members and for staff without the capability.
- ✔ Unauthorised page requests receive an HTTP redirect with no content.

## 5. Non-functional

- Time zone America/New_York for all schedules; DST-safe recurrence (tested).
- Structured logs with identifiers only; audit log append-only.
- Development and production configuration separated by environment variables.
- Synthetic demo data only; sandbox payments labelled on every page.

## 6. Assumptions

- Currency is USD. One household holds one live membership and one billing account.
- AAC, not Stripe, owns recurring dues scheduling (see docs/integrations.md).
- Corporate plans are staff-arranged, not publicly purchasable.
- Dependents are under 26; the primary member is 18 or older.
- A paid booking cancelled late is not refunded; free bookings may carry a late-cancel fee.
- Tours run Monday–Saturday, hourly 9:00–17:00, one per slot.
- Partner SSO/API connections require partner documentation and credentials that do not yet exist.
