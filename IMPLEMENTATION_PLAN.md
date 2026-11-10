# Implementation plan and status

Last updated: 2026-11-10. Status legend: ✅ built and verified · 🟡 partial · ⬜ not started.

## Milestone 1 — Foundation (✅ complete, with the limits listed below)

Journey verified end to end in a browser at phone and desktop sizes:
inquiry → tour → enrollment → payment → booking → partner launch → staff follow-up.

| Area | Status | Notes |
| --- | --- | --- |
| Authentication, sessions | ✅ | Better Auth email/password. No self sign-up; logins come from enrollment or the primary member. |
| Staff roles and capabilities | ✅ | sales, front_desk, coach, kids_club, manager, finance, admin. Enforced in modules. |
| People / households / permissions | ✅ | Separate tables; explicit booking, billing, charge permissions and limits; declared + staff-verified guardianship. |
| Membership plans and enrollment | ✅ | Individual, couple, family, corporate (private). Agreement + waiver acceptance. Atomic and idempotent. |
| Freeze / unfreeze / cancel | ✅ | Effective-dated; future changes applied by daily job. No proration or billing effect yet (M2). |
| Digital member ID and check-in | ✅ | Member number + QR on the card; staff check-in by ID or name search. No camera scanner. |
| CRM | ✅ | Capture, de-duplication, attribution, round-robin assignment, stages, tours, tasks, notes, conversion report, consent history. |
| Native booking: classes and performance training | ✅ | Capacity, booking window, eligibility, accepted terms snapshot, holds, cancellation, attendance, no-show fees. |
| Resource conflicts | 🟡 | Exclusion constraint, room-bound sessions and maintenance blocks are enforced and tested. Member court/golf slot picker is M2. |
| Payments (sandbox) | ✅ | Hosted-checkout flow, webhooks, refunds, delayed methods, reconciliation — exercised with the built-in sandbox processor. |
| Payments (Stripe) | 🟡 | Adapter written against the Stripe SDK and shares the webhook code path. **Not yet run against a Stripe account** (no credentials available). |
| Club-account ledger | ✅ | Immutable entries, reversals, Charge to Club Account with limits, Pay Now for balance, itemised activity. |
| Partner services directory | ✅ | Admin CRUD, approved-domain validation, visibility rules, launcher, fallbacks, launch events. Link and HTTPS deep-link modes. |
| Audit log | ✅ | Append-only; membership, booking, payment, permission, partner, session changes. |
| Versioned API | 🟡 | `/api/v1` plans, schedule, leads, tours, partners (public); bookings (signed-in, same-site). |
| Jobs | 🟡 | Idempotent HTTP-triggered jobs (reconcile, expire holds, membership changes). Needs an external scheduler. |

### Known limits in Milestone 1

- No email or SMS is sent (confirmations, receipts, invitations, password reset). A second
  adult's login is created by the primary member with a temporary password as a stopgap.
- No recurring dues collection yet: only the first period is charged at enrollment.
- Adding/removing household members after enrollment, plan changes and discounts/add-ons are not built.
- Waitlists, guest rules, buffer times and coach availability are not built.
- Public rate limiting is in-process (single instance).
- Error monitoring is a structured-log hook (`reportError`); no external service is wired.
- Membership documents are synthetic placeholders and must be replaced by counsel-approved text.

## Milestone 2 — Operations (⬜)

1. Recurring billing run owned by AAC (off-session charges on saved methods, dunning,
   failed-payment handling, overdue-account suspension rules), statements (monthly, PDF/export).
2. Transactional email/SMS; emailed invitations and password reset; booking reminders.
3. Training packages and session credits (reserve on booking, consume on attendance,
   restore on timely cancel, expire by date) with a concurrency test for overspend.
4. Personal training: coach assignment and availability, recurring plans, programming and progress notes.
5. Court and golf-bay slot booking UI on the existing reservation constraint; buffers, guest rules, waitlists.
6. Kids Club: child profiles, authorised pickups, emergency contacts, restricted notes,
   rooms/ratios, time limits, check-in/out with pickup verification.
7. Household changes after enrollment, plan changes with proration, discounts and add-ons.
8. Operational reporting; admin UI for plans, services and policies (currently seed/database).

## Milestone 3 — Integrations and scale (⬜)

1. Verify the Stripe adapter in Stripe test mode; saved-method management UI.
2. Shopify connector (verified customer linking, order/refund/fulfilment import, idempotent).
3. Website components (embed + hosted pages) and cross-domain sign-in.
4. Partner SSO/API adapters where a partner documents one.
5. Durable job queue, scheduled reconciliation reports, failed-event tooling.
6. Load test with ~3,000 member profiles; publish targets and results; caching and index tuning.
7. Deployment hardening: error monitoring service, backups + restore drill, data exports.

## Proposed performance targets (to be measured in Milestone 3)

p95 under 300 ms for schedule and portal pages, under 500 ms for booking confirmation, with
50 concurrent bookers on one session producing zero over-capacity bookings, on a
2 vCPU / 4 GB app instance and a comparable PostgreSQL instance. **Not yet measured.**

## Verification log

2026-11-10 — `npm run typecheck` clean · `npm run lint` clean · `npm run build` succeeds ·
`npm test` 60/60 · `npm run e2e` 98/98 (390×844 and 1280×800).
