/**
 * Demo seed. ALL DATA IS SYNTHETIC. Members are enrolled through the real enrollment and
 * payment code paths using the SANDBOX payment processor.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { insertBaseData } from "@/db/base-data";
import { billingAccounts, householdMembers, leads, persons, resources, services, staffRoles, type StaffRole } from "@/db/schema";
import { clubDate } from "@/lib/time";
import { startCheckout } from "@/modules/billing/payments";
import { SandboxProvider } from "@/modules/billing/providers/sandbox";
import { setPaymentProvider } from "@/modules/billing/providers";
import { bookSession, generateWeeklySessions, listSessions, termsFor } from "@/modules/booking/engine";
import { addLeadActivity, captureLead, scheduleTour, availableTourSlots, updateLead } from "@/modules/crm/leads";
import { loadActor } from "@/modules/identity/actor";
import { createLogin } from "@/modules/identity/people";
import { enroll } from "@/modules/membership/enrollment";

export const DEMO_PASSWORD = "ClubDemo!2026";

const STAFF: { email: string; name: string; roles: StaffRole[] }[] = [
  { email: "admin@aac.test", name: "Avery Admin", roles: ["admin"] },
  { email: "manager@aac.test", name: "Morgan Manager", roles: ["manager"] },
  { email: "sales@aac.test", name: "Sam Sales", roles: ["sales"] },
  { email: "frontdesk@aac.test", name: "Frankie Desk", roles: ["front_desk"] },
  { email: "coach@aac.test", name: "Casey Coach", roles: ["coach"] },
  { email: "finance@aac.test", name: "Finley Finance", roles: ["finance"] },
  { email: "kidsclub@aac.test", name: "Kit Kidsclub", roles: ["kids_club"] },
];

async function main() {
  const sandbox = new SandboxProvider();
  setPaymentProvider(sandbox);
  const [already] = await db.select({ id: staffRoles.userId }).from(staffRoles).limit(1);
  if (already) {
    console.log("Database already seeded; run `npm run db:reset` to start over.");
    return;
  }
  await insertBaseData(db);

  const staffIds: Record<string, string> = {};
  for (const s of STAFF) {
    const id = await createLogin(db, { email: s.email, name: s.name, password: DEMO_PASSWORD });
    staffIds[s.email] = id;
    await db.insert(staffRoles).values(s.roles.map((role) => ({ userId: id, role })));
  }
  const admin = await loadActor(staffIds["admin@aac.test"]!);
  const sales = await loadActor(staffIds["sales@aac.test"]!);
  const coachId = staffIds["coach@aac.test"]!;

  // Three weeks of classes in club-local time.
  const today = clubDate();
  const svc = Object.fromEntries((await db.select().from(services)).map((s) => [s.slug, s]));
  const res = Object.fromEntries((await db.select().from(resources)).map((r) => [r.name, r]));
  await db.transaction(async (tx) => {
    const base = { fromDate: today, days: 21 };
    await generateWeeklySessions(tx, svc["hiit"]!, { ...base, weekdays: [1, 3, 5], time: "06:00", coachUserId: coachId, resourceId: res["Studio A"]!.id });
    await generateWeeklySessions(tx, svc["hiit"]!, { ...base, weekdays: [2, 4], time: "17:30", coachUserId: coachId, resourceId: res["Studio A"]!.id });
    await generateWeeklySessions(tx, svc["yoga"]!, { ...base, weekdays: [1, 2, 3, 4, 5, 6], time: "09:00", resourceId: res["Studio B"]!.id });
    await generateWeeklySessions(tx, svc["performance"]!, { ...base, weekdays: [1, 3, 5], time: "16:00", coachUserId: coachId, resourceId: res["Performance Turf"]!.id });
    await generateWeeklySessions(tx, svc["performance"]!, { ...base, weekdays: [6], time: "10:00", coachUserId: coachId, resourceId: res["Performance Turf"]!.id });
    await generateWeeklySessions(tx, svc["pickleball-clinic"]!, { ...base, weekdays: [2, 6], time: "18:00", resourceId: res["Court 1"]!.id });
  });

  // Leads at various stages (created before members so conversion can be demonstrated).
  const leadSeeds = [
    ["Riley", "Nguyen", "riley.nguyen@example.test", "706-555-0101", "family", "website", "google", "cpc"],
    ["Jordan", "Avery", "member@aac.test", "706-555-0102", "family", "website", "instagram", "social"],
    ["Taylor", "Brooks", "taylor.brooks@example.test", "706-555-0103", "individual", "referral", null, null],
    ["Alex", "Kim", "alex.kim@example.test", "706-555-0104", "couple", "walk_in", null, null],
    ["Jamie", "Patel", "jamie.patel@example.test", "706-555-0105", "individual", "website", "google", "organic"],
    ["Drew", "Santos", "drew.santos@example.test", "706-555-0106", "corporate", "event", null, null],
    ["Quinn", "Harper", "quinn.harper@example.test", "706-555-0107", "family", "website", "facebook", "social"],
    ["Reese", "Coleman", "reese.coleman@example.test", "706-555-0108", "individual", "referral", null, null],
  ] as const;
  const leadIds: string[] = [];
  for (const [firstName, lastName, email, phone, interest, source, utmSource, utmMedium] of leadSeeds) {
    const r = await captureLead({ firstName, lastName, email, phone, interest, source, utmSource: utmSource ?? undefined, utmMedium: utmMedium ?? undefined, message: "I'd like to learn more about membership.", marketingEmailOptIn: true });
    leadIds.push(r.leadId);
  }
  const slots = await availableTourSlots();
  await scheduleTour({ lead: { firstName: "Riley", lastName: "Nguyen", email: "riley.nguyen@example.test", source: "website" }, scheduledAt: slots[3]! });
  await scheduleTour({ lead: { firstName: "Alex", lastName: "Kim", email: "alex.kim@example.test", source: "walk_in" }, scheduledAt: slots[12]! });
  await addLeadActivity(sales, { leadId: leadIds[2]!, type: "call", body: "Left voicemail; will try again tomorrow." });
  await updateLead(sales, { leadId: leadIds[4]!, stage: "proposal" });
  await updateLead(sales, { leadId: leadIds[7]!, stage: "lost", lostReason: "Moved out of the area" });

  // Members, enrolled and paid through the sandbox processor.
  const enrollAndPay = async (input: Parameters<typeof enroll>[0]) => {
    const r = await enroll(input);
    const { payment } = await startCheckout(r.paymentId!, { successPath: "/join/complete", cancelPath: "/join" });
    await sandbox.simulate(payment.providerCheckoutId!, "success");
    return r;
  };
  const common = { acceptAgreement: true as const, acceptWaiver: true as const };
  const fam = await enrollAndPay({
    ...common,
    planCode: "family",
    idempotencyKey: "seed-family-avery",
    marketingEmailOptIn: true,
    primary: { firstName: "Jordan", lastName: "Avery", email: "member@aac.test", phone: "706-555-0102", dateOfBirth: "1986-04-12", password: DEMO_PASSWORD },
    additionalMembers: [
      { firstName: "Casey", lastName: "Avery", dateOfBirth: "1988-09-30", relationship: "adult" },
      { firstName: "Mia", lastName: "Avery", dateOfBirth: "2015-06-01", relationship: "dependent" },
      { firstName: "Leo", lastName: "Avery", dateOfBirth: "2018-11-20", relationship: "dependent" },
    ],
  });
  await db.update(billingAccounts).set({ chargeEnabled: true, creditLimitCents: 50000 }).where(eq(billingAccounts.id, fam.billingAccountId));
  await enrollAndPay({
    ...common,
    planCode: "individual",
    idempotencyKey: "seed-individual-ellis",
    primary: { firstName: "Parker", lastName: "Ellis", email: "solo@aac.test", phone: "706-555-0120", dateOfBirth: "1992-02-03", password: DEMO_PASSWORD },
  });
  await enrollAndPay({
    ...common,
    planCode: "couple",
    idempotencyKey: "seed-couple-okafor",
    primary: { firstName: "Dana", lastName: "Okafor", email: "couple@aac.test", phone: "706-555-0130", dateOfBirth: "1979-07-19", password: DEMO_PASSWORD },
    additionalMembers: [{ firstName: "Chris", lastName: "Okafor", dateOfBirth: "1981-01-08", relationship: "adult" }],
  });

  // A few bookings for the demo family.
  const jordan = await loadActor(fam.userId);
  const upcoming = await listSessions({ from: new Date(), to: new Date(Date.now() + 6 * 24 * 3600 * 1000) });
  const hiit = upcoming.find((s) => s.serviceSlug === "hiit");
  const perf = upcoming.find((s) => s.serviceSlug === "performance");
  const kids = await db.select({ id: persons.id, firstName: persons.firstName }).from(persons).innerJoin(householdMembers, eq(householdMembers.personId, persons.id)).where(eq(householdMembers.householdId, fam.householdId));
  if (hiit) await bookSession(jordan, { sessionId: hiit.sessionId, participantPersonId: jordan.personId!, paymentMethod: "included", acceptedPolicyVersion: 1, acceptedPriceCents: 0, idempotencyKey: "seed-booking-1" });
  if (perf) {
    const t = termsFor(svc["performance"]!);
    await bookSession(jordan, { sessionId: perf.sessionId, participantPersonId: kids.find((k) => k.firstName === "Mia")!.id, paymentMethod: "club_account", acceptedPolicyVersion: t.policyVersion, acceptedPriceCents: t.priceCents, idempotencyKey: "seed-booking-2" });
  }
  void admin;
  const [{ n } = { n: 0 }] = await db.select({ n: db.$count(leads) }).from(leads).limit(1);
  console.log(`Seeded synthetic demo data: ${STAFF.length} staff, 3 households, ${n} leads.`);
  console.log(`Demo logins (password ${DEMO_PASSWORD}): member@aac.test, solo@aac.test, couple@aac.test, admin@aac.test, sales@aac.test, frontdesk@aac.test, manager@aac.test, finance@aac.test, coach@aac.test`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
