const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The IANA zone's offset from UTC, in minutes, at the given instant (positive east of UTC).
 * Implemented with `Intl.DateTimeFormat` offset math since this project has no date/timezone
 * library: format the instant in the target zone, reinterpret those wall-clock components as
 * UTC, and the difference from the original instant is the zone's offset at that moment.
 */
function timeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const lookup: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") lookup[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(
    lookup["year"] ?? 1970,
    (lookup["month"] ?? 1) - 1,
    lookup["day"] ?? 1,
    lookup["hour"] ?? 0,
    lookup["minute"] ?? 0,
    lookup["second"] ?? 0,
  );
  return (asUtc - instant.getTime()) / 60_000;
}

/**
 * Resolves the UTC instant for 23:59:59.999 on the given calendar date (`YYYY-MM-DD`) as
 * observed in `timeZone`. Used to turn a manager-chosen due date into a stored UTC `dueAt`.
 *
 * The offset is derived twice: once from the naive guess, then again from the corrected
 * instant, so a due date that falls on a DST transition day still resolves using the offset
 * actually in effect at day's end rather than the offset at the start of the calculation.
 */
export function endOfDayInTimeZone(calendarDate: string, timeZone: string): Date {
  const match = CALENDAR_DATE_PATTERN.exec(calendarDate);
  if (!match) throw new Error("Expected a YYYY-MM-DD calendar date.");
  const [, yearText, monthText, dayText] = match as unknown as [string, string, string, string];
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  // Whole-second UTC instant for the wall-clock end of day; the trailing .999ms is added back
  // after offset resolution so Intl formatting (which can round fractional seconds) never sees it.
  const wallClockWholeSecond = Date.UTC(year, month - 1, day, 23, 59, 59, 0);
  const wallClockEndOfDay = wallClockWholeSecond + 999;

  let offsetMinutes = timeZoneOffsetMinutes(new Date(wallClockWholeSecond), timeZone);
  let instant = wallClockEndOfDay - offsetMinutes * 60_000;
  offsetMinutes = timeZoneOffsetMinutes(new Date(instant - (instant % 1000)), timeZone);
  instant = wallClockEndOfDay - offsetMinutes * 60_000;

  return new Date(instant);
}
