import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { consentEvents, leadActivities, leads, leadTasks, tours } from "@/db/schema";
import { addLeadActivity, availableTourSlots, captureLead, conversionReport, getLead, scheduleTour, setTourStatus, updateLead } from "@/modules/crm/leads";
import { ensureBase, makeStaff, tally, uid } from "./helpers";

beforeAll(ensureBase);
const contact = () => ({ firstName: "Lee", lastName: "Morgan", email: `${uid()}@lead.test`, phone: `706-${Math.floor(1000000 + Math.random() * 8999999)}` });

describe("lead capture", () => {
  it("captures attribution, consent and a first follow-up task", async () => {
    const c = contact();
    const { leadId, duplicate } = await captureLead({ ...c, source: "website", utmSource: "google", utmMedium: "cpc", utmCampaign: "spring", marketingEmailOptIn: true, message: "Tell me about family plans" });
    expect(duplicate).toBe(false);
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(lead).toMatchObject({ stage: "new", source: "website", utmSource: "google", utmCampaign: "spring", marketingEmailOptIn: true, marketingSmsOptIn: false });
    expect(await db.select().from(leadTasks).where(eq(leadTasks.leadId, leadId))).toHaveLength(1);
    const consent = await db.select().from(consentEvents).where(eq(consentEvents.leadId, leadId));
    expect(consent.map((e) => [e.channel, e.granted]).sort()).toEqual([["email", true], ["sms", false]]);
  });

  it("detects duplicates by email or phone (formatting-insensitive), including simultaneous submissions", async () => {
    const c = contact();
    const results = await Promise.all(Array.from({ length: 6 }, () => captureLead({ ...c, source: "website" })));
    expect(new Set(results.map((r) => r.leadId)).size).toBe(1);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    const byPhone = await captureLead({ firstName: "L", lastName: "M", phone: `+1 (${c.phone.slice(0, 3)}) ${c.phone.slice(4)}`, source: "walk_in", message: "Stopped by the desk" });
    expect(byPhone).toMatchObject({ leadId: results[0]!.leadId, duplicate: true });
    const byEmail = await captureLead({ firstName: "L", lastName: "M", email: c.email.toUpperCase(), source: "event" });
    expect(byEmail.duplicate).toBe(true);
    const acts = await db.select().from(leadActivities).where(eq(leadActivities.leadId, results[0]!.leadId));
    expect(acts.filter((a) => a.type === "inquiry").length).toBe(8);
    await expect(captureLead({ firstName: "No", lastName: "Contact", source: "website" })).rejects.toThrow();
  });
});

describe("tours and pipeline", () => {
  it("never double-books a tour slot", async () => {
    const [slot] = await availableTourSlots();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => scheduleTour({ lead: { ...contact(), source: "website" }, scheduledAt: slot! })));
    const { ok, codes } = tally(results);
    expect(ok).toHaveLength(1);
    expect(new Set(codes)).toEqual(new Set(["slot_unavailable"]));
    expect((await availableTourSlots()).some((s) => s.getTime() === slot!.getTime())).toBe(false);
    await expect(scheduleTour({ lead: { ...contact(), source: "website" }, scheduledAt: new Date(Date.now() + 1234567) })).rejects.toMatchObject({ code: "slot_unavailable" });
  });

  it("moves a lead through the pipeline with history, and reports conversion by source", async () => {
    const sales = await makeStaff("sales");
    const src = `src-${uid().slice(0, 6)}`;
    const slots = await availableTourSlots();
    const { leadId, tourId } = await scheduleTour({ lead: { ...contact(), source: src }, scheduledAt: slots[slots.length - 1]! });
    expect((await getLead(sales, leadId)).lead.stage).toBe("tour_scheduled");
    await setTourStatus(sales, tourId, "completed");
    await addLeadActivity(sales, { leadId, type: "call", body: "Discussed family plan." });
    await expect(updateLead(sales, { leadId, stage: "won" })).rejects.toMatchObject({ code: "validation_error" }); // only real enrollment wins a lead
    await expect(updateLead(sales, { leadId, stage: "lost" })).rejects.toMatchObject({ code: "validation_error" });
    await updateLead(sales, { leadId, stage: "lost", lostReason: "Price" });
    const detail = await getLead(sales, leadId);
    expect(detail.lead).toMatchObject({ stage: "lost", lostReason: "Price" });
    expect(detail.activities.map((a) => a.a.type)).toEqual(expect.arrayContaining(["inquiry", "tour", "call", "stage_change"]));
    expect((await db.select().from(tours).where(eq(tours.id, tourId)))[0]!.status).toBe("completed");
    const report = await conversionReport(sales);
    expect(report.find((r) => r.source === src)).toMatchObject({ leads: 1, toured: 1, won: 0, lost: 1 });
  });
});
