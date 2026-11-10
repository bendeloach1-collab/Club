# Integrations

Each provider sits behind an adapter so the core modules do not depend on it. Missing
credentials disable only that provider's live features.

| Integration | Status |
| --- | --- |
| Payments — sandbox processor | Built, tested. Simulation only. |
| Payments — Stripe | Adapter written; **not yet verified against a Stripe account**. |
| Partner links / deep links | Built, tested. |
| Partner SSO / API | Not built (Milestone 3). Such partners behave as plain links. |
| Shopify | Not built (Milestone 3). Design decisions below. |
| Website components | Not built (Milestone 3). Public API available. |
| Email / SMS | Not built (Milestone 2). |

## Payments

### Ownership

| Concern | Owner |
| --- | --- |
| Memberships, privileges, booking status | AAC |
| Club-account ledger, balances, statements | AAC |
| Prices, what is owed and when | AAC |
| **Recurring dues schedule** | **AAC only** — one scheduler raises dues and requests a charge. No Stripe Subscriptions, Subscription Schedules or Stripe Invoices are created, so dues cannot be scheduled twice. |
| Card/bank entry, authentication (3DS), storage of payment methods | Stripe |
| Charge execution, settlement, processor refund status | Stripe |

AAC stores only processor identifiers (customer, checkout session, payment intent). No card
or bank details reach AAC servers.

### Flow

1. AAC creates a `payments` row (unique idempotency key) for itemised line items.
2. `startCheckout` asks the adapter for a hosted checkout, passing the same key.
3. The customer pays on the processor's page.
4. The processor's webhook is verified, stored once by event id, and applied through the
   payment state machine, which posts ledger entries and fulfils the purchase.
5. On return, the page asks the processor for the payment's state server-side. A periodic
   job does the same for stragglers.

Handled events: `checkout.session.completed` (paid or awaiting a delayed method),
`checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
`checkout.session.expired`, `payment_intent.requires_action`, `payment_intent.processing`,
`payment_intent.payment_failed` (attempt failed; checkout stays open), `charge.refunded`.
Others are stored and ignored.

Refunds: staff refund from Billing; the adapter is called with an idempotency key derived
from the refunded total, and the ledger refund entry is posted when the processor reports it.
A refund made directly in the Stripe dashboard is picked up the same way.

### Sandbox processor (default)

`PAYMENT_PROVIDER=sandbox`. A simulated hosted checkout at `/sandbox/checkout/:id` lets you
choose success, decline, delayed bank debit (then success/failure) or cancel. It emits
Stripe-shaped events signed with `SANDBOX_WEBHOOK_SECRET` and processed by the same code as
Stripe events. No money moves. Do not run production with this provider.

### Stripe setup

1. Set `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY` (start with a `sk_test_` key).
2. Add a webhook endpoint `https://<host>/api/webhooks/stripe` subscribed to the events
   above; put its signing secret in `STRIPE_WEBHOOK_SECRET`.
3. A restricted key needs: Checkout Sessions write, PaymentIntents read, Charges read, Refunds write.
4. Check Staff → Integrations for configuration problems and webhook health.

Before going live, run the journey in Stripe test mode, including a declined card, a 3DS
card, a delayed method and a refund. That verification has not been done yet. Off-session
charging of saved methods (recurring dues) is Milestone 2; enrollment already asks Stripe to
save the method for future use.

## Partner services

Configured in Staff → Partner services. Fields: name, description, logo, category, approved
domains, booking/account/support URLs and labels, deep link, visibility, launch behaviour,
connection mode, status, display order, clinical flag.

| Mode | Behaviour today |
| --- | --- |
| Link | Opens the partner's HTTPS page. |
| Deep link | Opens an HTTPS universal/app link on an approved domain; the booking URL is the web fallback. Custom URL schemes are not supported. |
| Single sign-on | Not implemented; behaves as Link. Needs the partner's documented mechanism and a short-lived handoff. |
| API connection | Not implemented; behaves as Link. |

Rules enforced in code: HTTPS only, host on the approved list (`*.example.com` for
sub-domains), default port, no embedded credentials, no query parameters that look like
credentials or personal data. Checked on save and again at every launch. The launcher
(`/go/<slug>/<kind>`) takes its destination only from stored configuration, sends no member
data and no referrer, and leaves the AAC session intact.

A launch is only a click. AAC does not know whether the member booked, paid or signed in at
the partner, and the UI says so. For partners flagged clinical, the launch event is stored
without the member's identity, and nothing is sent to analytics or marketing. Clinical
records stay in the clinic's system.

Limitation: return navigation depends on the partner; with "new tab" the AAC tab stays open.

## Shopify (planned — decisions to implement and verify)

- Shopify stays authoritative for catalog, inventory, orders and fulfilment. AAC imports
  orders, refunds and fulfilment status read-only to show a member's retail history.
- Direction: Shopify → AAC only. AAC writes nothing to Shopify orders.
- Imports are keyed by Shopify order/refund id so replays do not duplicate. Imported retail
  sales never create AAC charges, invoices or ledger entries: they were paid in Shopify.
- Customer linking is explicit and verified (member proves control of the Shopify account, or
  staff confirm). A matching email alone never links or merges records.
- Member discounts, Shopify POS, and "Charge to Club Account" at checkout are **not assumed
  possible**. A custom payment method in Shopify checkout depends on plan and platform
  rules; each must be confirmed against current Shopify documentation and the club's plan
  before being promised. Until then retail is paid in Shopify.

## Website and API

`/api/v1` (JSON, versioned by path):

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /plans` | public | Plans and prices |
| `GET /schedule?from&days&category` | public | Sessions with live availability |
| `POST /leads` | public, rate-limited | Lead capture |
| `GET /tours/slots`, `POST /tours` | public, rate-limited | Tour scheduling |
| `GET /partners` | optional | Partner cards visible to the caller |
| `GET/POST /bookings`, `DELETE /bookings/:id` | session cookie, same-site | Member bookings; POST needs `Idempotency-Key` |

Routes call the same module functions as the portal, so rules are identical. Browser calls
from another origin are allowed only for public endpoints and only from origins listed in
`API_ALLOWED_ORIGINS`.

Today, any website platform can link to the hosted pages (`/membership`, `/join`, `/tour`,
`/inquire`, `/schedule`, `/login`) or call the public endpoints from its own code where the
platform permits custom code. Embedded components and compatibility with WordPress, Webflow,
Squarespace, Wix and Shopify storefronts have **not** been built or verified. Member sign-in
on another domain will use a redirect to the AAC-hosted login, not third-party cookies.

## Jobs

`POST /api/internal/jobs/<job>` with `Authorization: Bearer $JOBS_SECRET`:
`reconcile-payments` (every 5 min), `expire-holds` (every minute), `membership-changes`
(daily after midnight Eastern). All are idempotent. An external scheduler must call them.
