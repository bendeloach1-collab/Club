# AAC Club OS

Membership, CRM, scheduling, billing and partner-services platform for Athens Athletic Club.
Milestone 1 is implemented; see [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for exactly
what is and is not built, [SPEC.md](SPEC.md) for requirements and
[docs/integrations.md](docs/integrations.md) for providers.

> All seeded data is synthetic. The default payment provider is a labelled **sandbox**
> simulator — no real payments are collected.

## Setup

Requirements: Node.js 22+, PostgreSQL 16+.

```bash
# 1. Databases (as a PostgreSQL superuser)
psql -c "CREATE ROLE aac LOGIN PASSWORD 'aac' CREATEDB"
psql -c "CREATE DATABASE aac_dev OWNER aac" -c "CREATE DATABASE aac_test OWNER aac"

# 2. App
npm install
cp .env.example .env        # then set BETTER_AUTH_SECRET, SANDBOX_WEBHOOK_SECRET, JOBS_SECRET
npm run db:migrate
npm run db:seed
npm run dev                 # http://localhost:3000
```

Demo logins (password `ClubDemo!2026`): `member@aac.test` (family, club account enabled),
`solo@aac.test`, `couple@aac.test`; staff `admin@`, `manager@`, `sales@`, `frontdesk@`,
`finance@`, `coach@aac.test`.

## Checks

```bash
npm run typecheck && npm run lint && npm test && npm run build
npm run db:reset && npm start &   # then:
npm run e2e                       # browser journey at phone and desktop sizes
```

`npm test` runs against `TEST_DATABASE_URL` and resets that database each run.

## Deployment

- Run as a Node server (`npm run build`, `npm start`) behind HTTPS, with managed PostgreSQL.
- Set every variable in `.env.example` per environment. Production must set `NODE_ENV=production`,
  a strong `BETTER_AUTH_SECRET`, the real `APP_URL`, and `PAYMENT_PROVIDER=stripe` with keys.
  Keep separate databases, secrets and Stripe keys (test vs live) for each environment.
- Apply migrations on deploy: `npm run db:migrate`. Never run `db:reset` or `db:seed` in production.
- Schedule the jobs in docs/integrations.md with your platform's cron.
- Health check: `GET /api/health`.
- Logs are JSON lines on stdout without personal data; `reportError` in `src/lib/log.ts` is
  the place to attach an error-monitoring service (not wired yet).

### Backups and restore

Use the database host's automated backups with point-in-time recovery, plus a logical dump:

```bash
pg_dump --format=custom --no-owner "$DATABASE_URL" > aac-$(date +%F).dump
# restore into an empty database
pg_restore --no-owner --dbname "$RESTORE_DATABASE_URL" aac-YYYY-MM-DD.dump
```

After a restore, run `npm run db:migrate`, then trigger the `reconcile-payments` job so
payments made after the backup are re-read from the processor. A restore drill has not been
performed yet. Data exports beyond `pg_dump` are planned for Milestone 3.
