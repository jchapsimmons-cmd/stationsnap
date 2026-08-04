import { describe, expect, it } from "vitest";
import { endOfDayInTimeZone } from "@/lib/timezone";

describe("endOfDayInTimeZone", () => {
  it("resolves end of day in UTC itself", () => {
    expect(endOfDayInTimeZone("2026-01-15", "UTC").toISOString()).toBe("2026-01-15T23:59:59.999Z");
  });

  it("resolves end of day for a zone west of UTC", () => {
    // America/Chicago is UTC-6 in January (standard time, no DST).
    expect(endOfDayInTimeZone("2026-01-15", "America/Chicago").toISOString()).toBe(
      "2026-01-16T05:59:59.999Z",
    );
  });

  it("resolves end of day for a zone east of UTC", () => {
    // Asia/Tokyo is UTC+9 year-round.
    expect(endOfDayInTimeZone("2026-01-15", "Asia/Tokyo").toISOString()).toBe(
      "2026-01-15T14:59:59.999Z",
    );
  });

  it("resolves end of day using the offset in effect after a spring-forward DST transition", () => {
    // Clocks in America/New_York spring forward on 2026-03-08; by 23:59:59.999 local time
    // that day is already in EDT (UTC-4), not the EST (UTC-5) that was in effect at midnight.
    expect(endOfDayInTimeZone("2026-03-08", "America/New_York").toISOString()).toBe(
      "2026-03-09T03:59:59.999Z",
    );
  });

  it("resolves end of day using the offset in effect after a fall-back DST transition", () => {
    // Clocks in America/New_York fall back on 2026-11-01; by 23:59:59.999 local time that
    // day is in EST (UTC-5).
    expect(endOfDayInTimeZone("2026-11-01", "America/New_York").toISOString()).toBe(
      "2026-11-02T04:59:59.999Z",
    );
  });

  it("throws for a malformed calendar date", () => {
    expect(() => endOfDayInTimeZone("2026/01/15", "UTC")).toThrow();
    expect(() => endOfDayInTimeZone("not-a-date", "America/Chicago")).toThrow();
  });
});
