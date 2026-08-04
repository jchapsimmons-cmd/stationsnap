import { describe, expect, it } from "vitest";
import {
  calendarDateInTimeZone,
  endOfDayInTimeZone,
  isoWeekStartInTimeZone,
} from "@/lib/timezone";

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

describe("calendarDateInTimeZone", () => {
  it("returns the same date in UTC", () => {
    expect(calendarDateInTimeZone(new Date("2026-01-15T05:30:00Z"), "UTC")).toBe("2026-01-15");
  });

  it("returns the prior calendar date for a zone west of UTC before its offset elapses", () => {
    expect(calendarDateInTimeZone(new Date("2026-01-15T05:30:00Z"), "America/Chicago")).toBe(
      "2026-01-14",
    );
  });
});

describe("isoWeekStartInTimeZone", () => {
  it("resolves the Monday for a mid-week date", () => {
    expect(isoWeekStartInTimeZone(new Date("2026-01-15T12:00:00Z"), "UTC")).toBe("2026-01-12");
  });

  it("resolves to itself for a date that is already a Monday", () => {
    expect(isoWeekStartInTimeZone(new Date("2026-01-19T12:00:00Z"), "UTC")).toBe("2026-01-19");
  });

  it("resolves the Monday using the zone's own calendar date, not UTC's", () => {
    // 2026-01-15T05:30:00Z is still 2026-01-14 (a Wednesday) in America/Chicago, so the ISO
    // week start is one day earlier than the UTC calendar date would suggest.
    expect(isoWeekStartInTimeZone(new Date("2026-01-15T05:30:00Z"), "America/Chicago")).toBe(
      "2026-01-12",
    );
  });
});
