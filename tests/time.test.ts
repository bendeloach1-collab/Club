import { describe, expect, it } from "vitest";
import { addDays, addMonths, clubDate, clubTimeToUtc, formatClubTime } from "@/lib/time";

describe("club time (America/New_York)", () => {
  it("converts standard and daylight wall times", () => {
    expect(clubTimeToUtc("2026-01-15", "06:00").toISOString()).toBe("2026-01-15T11:00:00.000Z"); // EST
    expect(clubTimeToUtc("2026-07-15", "06:00").toISOString()).toBe("2026-07-15T10:00:00.000Z"); // EDT
  });

  it("keeps a weekly 6:00 class at 6:00 local across both DST changes", () => {
    for (const start of ["2026-03-01", "2026-10-25"]) {
      for (let w = 0; w < 3; w++) {
        const at = clubTimeToUtc(addDays(start, 7 * w), "06:00");
        expect(formatClubTime(at)).toBe("6:00 AM");
      }
    }
    // Spring forward: the UTC gap between consecutive weekly sessions is 167h, not 168h.
    const before = clubTimeToUtc("2026-03-01", "06:00").getTime();
    const after = clubTimeToUtc("2026-03-08", "06:00").getTime();
    expect((after - before) / 3600000).toBe(167);
  });

  it("resolves the spring-forward gap and fall-back overlap deterministically", () => {
    // 02:30 does not exist on 2026-03-08; it resolves to the instant after the gap (03:30 EDT).
    expect(clubTimeToUtc("2026-03-08", "02:30").toISOString()).toBe("2026-03-08T07:30:00.000Z");
    // 01:30 occurs twice on 2026-11-01; the first (EDT) occurrence is chosen.
    expect(clubTimeToUtc("2026-11-01", "01:30").toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  it("derives the club date near midnight UTC and clamps month arithmetic", () => {
    expect(clubDate(new Date("2026-06-02T03:30:00Z"))).toBe("2026-06-01");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
  });
});
