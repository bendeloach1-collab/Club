/**
 * SYNTHETIC reference data (plans, documents, services, partners) used by the demo seed and
 * the automated tests. Everything here is fictional and editable at runtime.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { documents, membershipPlans, partnerServices, resources, services } from "@/db/schema";

export async function insertBaseData(db: Db) {
  await db
    .insert(membershipPlans)
    .values([
      { code: "individual", name: "Individual", type: "individual", duesCents: 8900, enrollmentFeeCents: 9900, maxAdults: 1, maxDependents: 0, sortOrder: 1, description: "Full club access for one adult.", benefits: ["Full fitness floor and locker rooms", "Unlimited group classes", "Member pricing on training"] },
      { code: "couple", name: "Couple", type: "couple", duesCents: 14900, enrollmentFeeCents: 9900, maxAdults: 2, maxDependents: 0, sortOrder: 2, description: "Two adults in one household.", benefits: ["Everything in Individual", "Separate logins for each adult", "Shared club account"] },
      { code: "family", name: "Family", type: "family", duesCents: 19900, enrollmentFeeCents: 14900, maxAdults: 2, maxDependents: 6, sortOrder: 3, description: "Two adults and dependents under 26.", benefits: ["Everything in Couple", "Kids Club access", "Youth performance programs", "Recovery lounge partner access"] },
      { code: "corporate", name: "Corporate", type: "corporate", duesCents: 7400, enrollmentFeeCents: 0, maxAdults: 1, maxDependents: 0, sortOrder: 4, isPublic: false, description: "Employer-sponsored individual membership.", benefits: ["Full club access"] },
    ])
    .onConflictDoNothing();

  await db
    .insert(documents)
    .values([
      { kind: "membership_agreement", version: 1, title: "Membership Agreement", body: "SYNTHETIC DEMONSTRATION TEXT. Membership renews each billing period until cancelled. Dues are billed in advance by Athens Athletic Club. Freezes and cancellations take effect on the date confirmed by the club. This placeholder must be replaced with counsel-approved terms before launch." },
      { kind: "liability_waiver", version: 1, title: "Liability Waiver", body: "SYNTHETIC DEMONSTRATION TEXT. Use of club facilities involves inherent risk. The member accepts responsibility for their own participation and that of their dependents. This placeholder must be replaced with counsel-approved terms before launch." },
    ])
    .onConflictDoNothing();

  await db
    .insert(partnerServices)
    .values([
      {
        slug: "golf-simulator",
        name: "Fairway Golf Simulators",
        description: "Reserve a simulator bay with our golf technology partner.",
        category: "golf",
        connectionMode: "link",
        approvedDomains: ["booking.fairway-sim.example"],
        bookingUrl: "https://booking.fairway-sim.example/athens-athletic-club",
        bookingLabel: "Book Golf",
        accountUrl: "https://booking.fairway-sim.example/account",
        accountLabel: "My Golf Reservations",
        visibility: { audience: "members" },
        status: "active",
        displayOrder: 1,
      },
      {
        slug: "physical-therapy",
        name: "Classic City Physical Therapy",
        description: "On-site physical therapy provided by an independent clinical partner. Clinical records stay with the clinic.",
        category: "physical-therapy",
        connectionMode: "link",
        approvedDomains: ["schedule.classiccity-pt.example", "portal.classiccity-pt.example"],
        bookingUrl: "https://schedule.classiccity-pt.example/new-appointment",
        bookingLabel: "Schedule Physical Therapy",
        accountUrl: "https://portal.classiccity-pt.example/",
        accountLabel: "Open Patient Portal",
        supportUrl: "https://schedule.classiccity-pt.example/contact",
        visibility: { audience: "public" },
        status: "active",
        handlesHealthInfo: true,
        displayOrder: 2,
      },
      {
        slug: "recovery-lounge",
        name: "Recovery Lounge",
        description: "Compression, sauna and cold-plunge sessions for Family plan members.",
        category: "wellness",
        connectionMode: "link",
        approvedDomains: ["recovery-lounge.example"],
        bookingUrl: "https://recovery-lounge.example/book",
        bookingLabel: "Book Recovery",
        visibility: { audience: "plans", planCodes: ["family"] },
        status: "active",
        displayOrder: 3,
      },
      {
        slug: "massage",
        name: "Massage Therapy",
        description: "Sports and therapeutic massage. Online scheduling is being set up.",
        category: "wellness",
        connectionMode: "link",
        approvedDomains: [],
        visibility: { audience: "members" },
        status: "unconfigured",
        displayOrder: 4,
      },
    ])
    .onConflictDoNothing();

  const [golf] = await db.select().from(partnerServices).where(eq(partnerServices.slug, "golf-simulator"));
  const [pt] = await db.select().from(partnerServices).where(eq(partnerServices.slug, "physical-therapy"));

  await db
    .insert(services)
    .values([
      { slug: "hiit", name: "HIIT Conditioning", category: "class", durationMinutes: 45, defaultCapacity: 16, memberPriceCents: 0, cancelWindowHours: 2, lateCancelFeeCents: 500, noShowFeeCents: 1000, description: "High-intensity intervals for all levels." },
      { slug: "yoga", name: "Vinyasa Yoga", category: "class", durationMinutes: 60, defaultCapacity: 20, memberPriceCents: 0, cancelWindowHours: 2, description: "Breath-led flow to build mobility and strength." },
      { slug: "performance", name: "Performance Training", category: "performance", durationMinutes: 60, defaultCapacity: 8, memberPriceCents: 2500, cancelWindowHours: 12, description: "Coach-led small-group speed, strength and power." },
      { slug: "pickleball-clinic", name: "Pickleball Clinic", category: "class", durationMinutes: 90, defaultCapacity: 8, memberPriceCents: 1500, cancelWindowHours: 24, description: "Skills and drills on the indoor courts." },
      { slug: "golf-simulator", name: "Golf Simulator", category: "golf", bookingMode: "partner", partnerServiceId: golf!.id, description: "Simulator bays are reserved with our golf partner." },
      { slug: "physical-therapy", name: "Physical Therapy", category: "event", bookingMode: "partner", partnerServiceId: pt!.id, requiresMembership: false, description: "Appointments are scheduled with our clinical partner." },
    ])
    .onConflictDoNothing();

  const existing = await db.select({ id: resources.id }).from(resources).limit(1);
  if (existing.length === 0) {
    await db.insert(resources).values([
      { name: "Studio A", type: "studio" },
      { name: "Studio B", type: "studio" },
      { name: "Performance Turf", type: "field" },
      { name: "Court 1", type: "court" },
      { name: "Court 2", type: "court" },
      { name: "Golf Bay 1", type: "golf_bay" },
      { name: "Golf Bay 2", type: "golf_bay" },
    ]);
  }
}
