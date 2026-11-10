# AAC Club OS

Club management platform for Athens Athletic Club: public site, member portal, staff console.
See SPEC.md (requirements), IMPLEMENTATION_PLAN.md (status), docs/integrations.md (providers).

## Commands

```bash
npm run dev          # dev server on :3000
npm run build        # production build
npm start            # serve the production build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # vitest against TEST_DATABASE_URL (resets + migrates it)
npm run e2e          # browser journey, phone + desktop; needs `npm run db:reset && npm run build && npm start`
npm run db:generate  # drizzle-kit: generate a migration after editing src/db/schema.ts
npm run db:migrate   # apply ./drizzle migrations to DATABASE_URL
npm run db:seed      # synthetic demo data (password ClubDemo!2026)
npm run db:reset     # DEV ONLY: drop, migrate, seed
```

PostgreSQL 16 must be running (`service postgresql start` in the cloud container) with
databases `aac_dev` and `aac_test` owned by role `aac` (see README).

## Stack

Next.js 16 App Router · React 19 · TypeScript (strict) · PostgreSQL + Drizzle ORM ·
Better Auth (email/password, cookie sessions) · Tailwind v4 · Vitest · Stripe SDK.

## Layout

- `src/db/schema.ts` — all tables. `drizzle/0001_constraints.sql` — hand-written exclusion
  constraint, immutability triggers, checks. Never edit an applied migration.
- `src/modules/<domain>/` — all business logic: identity, membership, crm, booking, billing,
  partners, audit. Pages, server actions and `/api/v1` routes are thin and call modules.
- `src/app/(public)`, `src/app/portal`, `src/app/staff` — the three experiences.
- `tests/` — integration tests on a real database. `e2e/journey.mjs` — browser journey.

## Rules that must hold

- Every module function touching private data takes an `Actor` and authorises on the server.
  Foreign households are reported as not-found. UI visibility is never the control.
- Money is integer cents + currency. `ledger_entries` is immutable; correct with reversals.
- Anything that charges or posts takes an idempotency key (unique in the database).
- Capacity/limit/overlap decisions happen inside a transaction holding the relevant row lock
  (session, billing account) or are enforced by a database constraint. Lock order:
  payment → session → billing account.
- All payment facts go through `applyPaymentUpdate` (billing/payments.ts). Never mark a
  payment paid from a browser redirect.
- AAC owns recurring billing schedules. Do not create Stripe Subscriptions or Invoices.
- Partner launches resolve only from stored config via `/go/[slug]/[kind]`; never redirect to
  a URL from the request, never append member data. A launch is not a booking.
- Club times are America/New_York: use `src/lib/time.ts`, never raw `Date` arithmetic on days.
- In raw `sql` subqueries, write table-qualified column names literally (`leads.id`); Drizzle
  renders `${table.col}` unqualified in single-table selects.
- Auth redirects must run before a Suspense/`loading.tsx` boundary (layouts, or pages without
  one) so they are real HTTP redirects.
- Client forms use `<Form dispatch pending>` from `components/forms.tsx` (keeps input on error).
- Label sandbox/mock integrations in the UI. Do not present unbuilt features as working.
