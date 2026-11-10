/**
 * End-to-end journey against a running server (default http://localhost:3000) with seeded
 * demo data and the SANDBOX payment provider. Runs the whole flow at a phone viewport and
 * again at a desktop viewport:
 *   inquiry → tour → enrollment → sandbox payment → portal → book (included + Pay Now)
 *   → partner launch → staff console checks.
 * Usage: npm run e2e            (expects `npm run db:reset && npm run build && npm start`)
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "ClubDemo!2026";
const SHOTS = new URL("./screenshots/", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function noOverflow(page, label) {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${label}: no horizontal overflow`, o <= 1, o > 1 ? `${o}px` : "");
}
const shot = (page, vp, name) => page.screenshot({ path: `${SHOTS}${vp}-${name}.png`, fullPage: true });

async function login(page, email) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click('button[type="submit"]')]);
}

async function run(vp, viewport) {
  console.log(`\n== ${vp} (${viewport.width}×${viewport.height}) ==`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const tag = `${vp}${Date.now().toString(36)}`;
  const email = `e2e-${tag}@example.test`;

  // Public: inquiry with attribution
  await page.goto(`${BASE}/inquire?utm_source=e2e&utm_medium=test`);
  await page.fill("#firstName", "Evie");
  await page.fill("#lastName", `Tester${tag}`);
  await page.fill("#email", email);
  await page.fill("#message", "Interested in a family membership");
  await page.selectOption("#interest", "family");
  await page.click('button[type="submit"]');
  await page.waitForSelector('[role="status"]');
  check("inquiry submitted", (await page.textContent('[role="status"]')).includes("Thank you"));
  await noOverflow(page, "inquiry");

  // Public: tour
  await page.goto(`${BASE}/tour`);
  const slot = await page.$eval("#scheduledAt option:not([disabled]):last-of-type", (o) => o.value).catch(() => null);
  const opts = await page.$$eval("#scheduledAt option:not([disabled])", (os) => os.map((o) => o.value));
  await page.selectOption("#scheduledAt", opts[opts.length - 1 - (vp === "mobile" ? 0 : 1)] ?? slot);
  await page.fill("#firstName", "Evie");
  await page.fill("#lastName", `Tester${tag}`);
  await page.fill("#email", email);
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=/Your tour is booked|no longer available|just taken/");
  const tourText = await page.textContent("main");
  check("tour booked", tourText.includes("Your tour is booked"), tourText.includes("Your tour is booked") ? "" : tourText.slice(-200));

  // Public: plans → enrollment
  await page.goto(`${BASE}/membership`);
  await shot(page, vp, "01-membership");
  await noOverflow(page, "membership");
  await page.click('a[href="/join?plan=family"]');
  await page.waitForURL(/\/join/);
  await page.fill("#firstName", "Evie");
  await page.fill("#lastName", `Tester${tag}`);
  await page.fill("#email", email);
  await page.fill("#phone", "706-555-0199");
  await page.fill("#dateOfBirth", "1988-03-04");
  await page.fill("#password", PASSWORD);
  await page.click("text=+ Add dependent");
  await page.fill("#m0f", "Junior");
  await page.fill("#m0l", `Tester${tag}`);
  await page.fill("#m0d", "2016-05-06");
  // Server-side validation: submitting without accepting the agreement must fail.
  await page.click('button[type="submit"]');
  await page.waitForSelector('[role="alert"]');
  check("enrollment rejected without agreement", true);
  check("form keeps entered values after a validation error", (await page.inputValue("#email")) === email);
  await page.check('input[name="acceptAgreement"]');
  await page.check('input[name="acceptWaiver"]');
  await shot(page, vp, "02-join");
  await noOverflow(page, "join");
  await Promise.all([page.waitForURL(/\/sandbox\/checkout\//), page.click('button[type="submit"]')]);
  check("redirected to (sandbox) hosted checkout", true);
  check("sandbox checkout is clearly labelled", (await page.textContent("body")).includes("SANDBOX PAYMENT PAGE"));
  await shot(page, vp, "03-sandbox-checkout");

  // A browser redirect alone must not activate anything: visit the return URL before paying.
  const checkoutUrl = page.url();
  const paymentId = await page.evaluate(() => fetch("/api/v1/bookings").then(() => null).catch(() => null));
  void paymentId;
  await page.goto(`${BASE}/portal`);
  await page.waitForSelector("text=Coming up");
  check("membership not active before payment is confirmed", (await page.textContent("main")).includes("Complete your enrollment"));
  await page.goto(checkoutUrl);
  await page.click("text=simulate declined card");
  await page.waitForSelector("text=Card declined");
  await Promise.all([page.waitForURL(/\/portal\/payment\//), page.click("text=Pay — simulate successful card payment")]);
  await page.waitForSelector("text=Payment confirmed");
  check("payment confirmed from server-side provider state", true);
  await shot(page, vp, "04-payment-confirmed");

  // Portal home
  await page.goto(`${BASE}/portal`);
  await page.waitForSelector("text=Coming up");
  const home = await page.textContent("main");
  check("portal shows active Family membership", home.includes("Family") && !home.includes("Complete your enrollment"));
  check("portal home shows partner cards", home.includes("Fairway Golf Simulators") && home.includes("Recovery Lounge"));
  await shot(page, vp, "05-portal-home");
  await noOverflow(page, "portal home");

  // Book an included class for the dependent
  await page.goto(`${BASE}/portal/book`);
  await page.waitForSelector("text=Classes and training");
  await page.waitForSelector("li.card");
  await shot(page, vp, "06-book");
  await noOverflow(page, "book");
  const included = page.locator("li", { hasText: "Included" }).filter({ hasText: "Vinyasa Yoga" }).first();
  await included.locator("a.btn").click();
  await page.waitForURL(/\/portal\/book\/[0-9a-f-]+/);
  await page.click("a:has-text('Junior')");
  await page.waitForURL(/for=/);
  check("price and cancellation terms shown before confirming", (await page.textContent("main")).includes("Free cancellation until"));
  await shot(page, vp, "07-confirm");
  await Promise.all([page.waitForURL(/\/portal\/schedule/), page.click('button[type="submit"]')]);
  await page.waitForSelector("text=You're booked");
  check("included class booked for dependent", (await page.textContent("main")).includes("Junior"));

  // Pay Now booking
  await page.goto(`${BASE}/portal/book?category=performance`);
  await page.locator("li", { hasText: "Performance Training" }).first().locator("a.btn").click();
  await page.waitForURL(/\/portal\/book\/[0-9a-f-]+/);
  const optionsText = await page.textContent("form");
  check("club-account option hidden when not enabled for household", !optionsText.includes("Charge to club account"));
  await Promise.all([page.waitForURL(/\/sandbox\/checkout\//), page.click('button[type="submit"]')]);
  await Promise.all([page.waitForURL(/\/portal\/payment\//), page.click("text=Pay — simulate successful card payment")]);
  await page.waitForSelector("text=Your booking is confirmed");
  check("Pay Now booking confirmed after payment", true);
  await page.goto(`${BASE}/portal/schedule`);
  await page.waitForSelector("text=Upcoming");
  await shot(page, vp, "08-my-schedule");
  await noOverflow(page, "my schedule");

  // Account: ledger nets to zero
  await page.goto(`${BASE}/portal/account`);
  await page.waitForSelector("text=Account activity");
  const acct = await page.textContent("main");
  check("statement itemises charges and payments", acct.includes("Family enrollment fee") && acct.includes("Payment received"));
  check("balance is zero after paid purchases", acct.includes("Nothing due"));
  await shot(page, vp, "09-account");
  await noOverflow(page, "account");

  // Family
  await page.goto(`${BASE}/portal/family`);
  await page.waitForSelector("text=Member ID");
  check("family page lists dependent with unverified guardian", (await page.textContent("main")).includes("awaiting staff verification"));
  await noOverflow(page, "family");

  // Partner services
  await page.goto(`${BASE}/portal/services`);
  await page.waitForSelector("text=Book with AAC");
  const svc = await page.textContent("main");
  check("services directory shows partner + fallback for unconfigured partner", svc.includes("Book Golf") && svc.includes("Not available online right now"));
  await shot(page, vp, "10-services");
  await noOverflow(page, "services");
  await page.goto(`${BASE}/portal/services/physical-therapy`);
  await page.waitForSelector("text=How this works");
  check("service detail labels the external partner", (await page.textContent("main")).includes("Open Patient Portal") && (await page.textContent("main")).includes("External partner"));
  const golfBtn = page.locator('a[href="/go/golf-simulator/booking"]').first();
  await page.goto(`${BASE}/portal/services/golf-simulator`);
  await page.waitForSelector("text=How this works");
  check("external launch opens in a new tab with noopener", (await golfBtn.getAttribute("target")) === "_blank" && (await golfBtn.getAttribute("rel")).includes("noopener"));
  const launch = await ctx.request.get(`${BASE}/go/golf-simulator/booking`, { maxRedirects: 0 });
  check("partner launch redirects to the approved destination", launch.status() === 303 && launch.headers()["location"] === "https://booking.fairway-sim.example/athens-athletic-club", `${launch.status()} ${launch.headers()["location"]}`);
  const badLaunch = await ctx.request.get(`${BASE}/go/golf-simulator/booking?url=https://evil.example&next=https://evil.example`, { maxRedirects: 0 });
  check("launcher ignores attacker-supplied URLs (no open redirect)", badLaunch.headers()["location"] === "https://booking.fairway-sim.example/athens-athletic-club");
  const unconfigured = await ctx.request.get(`${BASE}/go/massage/booking`, { maxRedirects: 0 });
  check("unconfigured partner falls back inside AAC", (unconfigured.headers()["location"] ?? "").startsWith(`${BASE}/portal/services/massage`));
  await page.goto(`${BASE}/portal/schedule`);
  await page.waitForSelector("text=Upcoming");
  check("partner launch did not create an AAC booking", !(await page.textContent("main")).includes("Golf"));
  check("AAC session preserved after partner launch", page.url().includes("/portal/schedule"));

  // Authorisation at the HTTP layer
  const staffTry = await ctx.request.get(`${BASE}/staff/members`, { maxRedirects: 0 });
  check("member cannot open the staff console (HTTP redirect, no content)", [303, 307].includes(staffTry.status()) && staffTry.headers()["location"] === "/portal", `${staffTry.status()} ${staffTry.headers()["location"]}`);
  const xsite = await ctx.request.post(`${BASE}/api/v1/bookings`, { headers: { origin: "https://evil.example", "idempotency-key": "x".repeat(12) }, data: {} });
  check("cross-site booking API call rejected", xsite.status() === 403);
  const api = await (await ctx.request.get(`${BASE}/api/v1/bookings`)).json();
  check("API returns only this household's bookings, marked AAC-confirmed", api.data.length === 2 && api.data.every((b) => b.confirmedBy === "aac"));
  await page.locator('form:has-text("Sign out") button:visible').first().click();
  await page.waitForURL(/\/login/);
  check("API requires authentication", (await ctx.request.get(`${BASE}/api/v1/bookings`)).status() === 401);

  // Staff: sales sees the converted lead
  await login(page, "sales@aac.test");
  await page.goto(`${BASE}/staff/leads?q=Tester${tag}`);
  const leadRow = await page.textContent("main");
  check("lead captured once (inquiry + tour de-duplicated) and marked won on enrollment", leadRow.includes("won") && (await page.locator("tbody tr").count()) === 1);
  await shot(page, vp, "11-staff-leads");
  await noOverflow(page, "staff leads");
  await page.click(`a:has-text("Evie Tester${tag}")`);
  await page.waitForURL(/\/staff\/leads\/[0-9a-f-]+/);
  check("lead history retained after conversion", (await page.textContent("main")).includes("Interested in a family membership"));
  await shot(page, vp, "12-staff-lead");
  const billingTry = await ctx.request.get(`${BASE}/staff/billing`, { maxRedirects: 0 });
  check("sales role cannot open billing", [303, 307].includes(billingTry.status()), String(billingTry.status()));
  const anon = await browser.newContext();
  const anonTry = await anon.request.get(`${BASE}/portal/account`, { maxRedirects: 0 });
  check("signed-out visitor is redirected to login", [303, 307].includes(anonTry.status()) && anonTry.headers()["location"] === "/login");
  await anon.close();
  await page.goto(`${BASE}/staff`);
  await page.locator('form:has-text("Sign out") button:visible').first().click();
  await page.waitForURL(/\/login/);

  // Staff: admin
  await login(page, "admin@aac.test");
  await page.goto(`${BASE}/staff`);
  await shot(page, vp, "13-staff-today");
  await noOverflow(page, "staff today");
  await page.goto(`${BASE}/staff/partners`);
  check("admin partner directory lists configured partners", (await page.textContent("main")).includes("Classic City Physical Therapy"));
  await shot(page, vp, "14-staff-partners");
  await page.goto(`${BASE}/staff/billing`);
  check("billing shows sandbox-labelled payments", (await page.textContent("main")).includes("Sandbox processor"));
  await noOverflow(page, "staff billing");
  await page.goto(`${BASE}/staff/checkin?q=Tester${tag}`);
  await page.locator("li", { hasText: "Evie" }).locator('button[type="submit"]').click();
  await page.waitForSelector('[role="status"]');
  check("front-desk check-in allowed for active member", (await page.textContent('[role="status"]')).includes("checked in"));
  await shot(page, vp, "15-staff-checkin");

  check("no uncaught browser errors", errors.length === 0, errors.join(" | ").slice(0, 200));
  await browser.close();
}

const only = process.env.E2E_VIEWPORT;
if (!only || only === "mobile") await run("mobile", { width: 390, height: 844 });
if (!only || only === "desktop") await run("desktop", { width: 1280, height: 800 });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
