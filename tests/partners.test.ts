import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { bookings, ledgerEntries, partnerLaunchEvents, partnerServices, payments } from "@/db/schema";
import { getPartnerCard, hostIsApproved, listPartnerCards, partnerUrlProblem, resolvePartnerLaunch, savePartner, type PartnerInput } from "@/modules/partners/partners";
import { ensureBase, makeHousehold, makeStaff, uid } from "./helpers";

beforeAll(ensureBase);

const config = (over: Partial<PartnerInput> = {}): PartnerInput => ({
  slug: `p-${uid().slice(0, 8)}`,
  name: "Test Partner",
  category: "wellness",
  connectionMode: "link",
  approvedDomains: ["book.partner.example"],
  bookingUrl: "https://book.partner.example/aac",
  visibility: { audience: "members" },
  launchTarget: "new_tab",
  status: "active",
  ...over,
});

describe("partner URL safety", () => {
  it("accepts only https URLs on approved domains", () => {
    const ok = ["book.partner.example", "*.clinic.example"];
    expect(partnerUrlProblem("https://book.partner.example/x?location=athens", ok)).toBeNull();
    expect(partnerUrlProblem("https://portal.clinic.example/", ok)).toBeNull();
    for (const bad of [
      "http://book.partner.example/x", // not https
      "https://evil.example/x",
      "https://book.partner.example.evil.example/x", // suffix trick
      "https://evilbook.partner.example/", // not an approved sub-domain pattern
      "https://clinic.example/", // wildcard does not cover the apex
      "https://user:pw@book.partner.example/", // embedded credentials
      "https://book.partner.example:8443/", // unexpected port
      "https://book.partner.example/x?token=abc", // credential-like parameter
      "https://book.partner.example/x?email=a@b.c", // personal data in URL
      "javascript:alert(1)",
      "//book.partner.example/x",
      "/relative",
      "data:text/html,hi",
    ]) {
      expect(partnerUrlProblem(bad, ok), bad).not.toBeNull();
    }
    expect(hostIsApproved("BOOK.partner.example.", ok)).toBe(true);
  });

  it("refuses to save an unsafe configuration", async () => {
    const admin = await makeStaff("admin");
    await expect(savePartner(admin, config({ bookingUrl: "https://attacker.example/phish" }))).rejects.toMatchObject({ code: "partner_config_invalid" });
    await expect(savePartner(admin, config({ accountUrl: "http://book.partner.example/account" }))).rejects.toMatchObject({ code: "partner_config_invalid" });
    await expect(savePartner(admin, config({ bookingUrl: "", accountUrl: "" }))).rejects.toMatchObject({ code: "partner_config_invalid" });
    await expect(savePartner(admin, config())).resolves.toMatchObject({ status: "active" });
  });
});

describe("partner visibility", () => {
  it("honours public, members-only and plan-specific visibility", async () => {
    const [family, individual, frozen] = await Promise.all([makeHousehold({ planCode: "family" }), makeHousehold({ planCode: "individual" }), makeHousehold({ status: "frozen" })]);
    const slugs = async (a: Parameters<typeof listPartnerCards>[0]) => (await listPartnerCards(a)).map((c) => c.slug);
    expect(await slugs(null)).toEqual(expect.arrayContaining(["physical-therapy"]));
    expect(await slugs(null)).not.toEqual(expect.arrayContaining(["golf-simulator"]));
    expect(await slugs(family.actor)).toEqual(expect.arrayContaining(["golf-simulator", "physical-therapy", "recovery-lounge", "massage"]));
    expect(await slugs(individual.actor)).toEqual(expect.arrayContaining(["golf-simulator"]));
    expect(await slugs(individual.actor)).not.toContain("recovery-lounge");
    expect(await slugs(frozen.actor)).not.toContain("golf-simulator");
    // Hidden partners cannot be opened or launched by guessing the slug.
    await expect(getPartnerCard(individual.actor, "recovery-lounge")).rejects.toMatchObject({ code: "not_found" });
    await expect(resolvePartnerLaunch(individual.actor, "recovery-lounge", "booking")).rejects.toMatchObject({ code: "not_found" });
    await expect(resolvePartnerLaunch(null, "golf-simulator", "booking")).rejects.toMatchObject({ code: "not_found" });
  });

  it("hides disabled partners and never exposes internal configuration to members", async () => {
    const admin = await makeStaff("admin");
    const h = await makeHousehold();
    const p = await savePartner(admin, config({ status: "disabled" }));
    expect((await listPartnerCards(h.actor)).map((c) => c.slug)).not.toContain(p.slug);
    const card = await getPartnerCard(h.actor, "golf-simulator");
    expect(card).not.toHaveProperty("approvedDomains");
    expect(card).not.toHaveProperty("bookingUrl");
    expect(card.actions.map((a) => a.label)).toEqual(["Book Golf", "My Golf Reservations"]);
  });
});

describe("partner launch", () => {
  it("redirects only to the configured destination and records nothing but a launch event", async () => {
    const h = await makeHousehold();
    const before = { bookings: await db.$count(bookings), payments: await db.$count(payments), ledger: await db.$count(ledgerEntries) };
    const { url } = await resolvePartnerLaunch(h.actor, "golf-simulator", "booking");
    expect(url).toBe("https://booking.fairway-sim.example/athens-athletic-club");
    // No member data is appended to the partner URL.
    expect(new URL(url).search).toBe("");
    expect(url).not.toContain(h.actor.personId);
    // A launch is not a confirmed appointment, a payment, or a charge.
    expect({ bookings: await db.$count(bookings), payments: await db.$count(payments), ledger: await db.$count(ledgerEntries) }).toEqual(before);
    const [golf] = await db.select().from(partnerServices).where(eq(partnerServices.slug, "golf-simulator"));
    const events = await db.select().from(partnerLaunchEvents).where(eq(partnerLaunchEvents.partnerServiceId, golf!.id));
    expect(events.some((e) => e.personId === h.actor.personId && e.linkKind === "booking")).toBe(true);
  });

  it("does not record which member launched a clinical partner", async () => {
    const h = await makeHousehold();
    await resolvePartnerLaunch(h.actor, "physical-therapy", "account");
    const [pt] = await db.select().from(partnerServices).where(eq(partnerServices.slug, "physical-therapy"));
    const events = await db.select().from(partnerLaunchEvents).where(eq(partnerLaunchEvents.partnerServiceId, pt!.id));
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.personId === null)).toBe(true);
  });

  it("re-validates at launch time: a destination that drifts off the approved list is blocked", async () => {
    const admin = await makeStaff("admin");
    const h = await makeHousehold();
    const p = await savePartner(admin, config());
    // Simulate configuration drift / tampering that bypassed the admin form.
    await db.update(partnerServices).set({ bookingUrl: "https://evil.example/login" }).where(eq(partnerServices.id, p.id));
    await expect(resolvePartnerLaunch(h.actor, p.slug, "booking")).rejects.toMatchObject({ code: "partner_unavailable" });
    const card = await getPartnerCard(h.actor, p.slug);
    expect(card).toMatchObject({ available: false, actions: [] });
  });

  it("shows a fallback instead of a launch for unconfigured or unavailable partners", async () => {
    const h = await makeHousehold();
    const card = await getPartnerCard(h.actor, "massage");
    expect(card).toMatchObject({ available: false, actions: [] });
    expect(card.unavailableReason).toMatch(/not set up yet/);
    await expect(resolvePartnerLaunch(h.actor, "massage", "booking")).rejects.toMatchObject({ code: "partner_unavailable" });
    await expect(resolvePartnerLaunch(h.actor, "golf-simulator", "support")).rejects.toMatchObject({ code: "partner_unavailable" });
  });
});
