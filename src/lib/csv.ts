/**
 * RFC 4181-style CSV encoding for report exports, with CSV/formula-injection defusing: a cell
 * that would open with a character a spreadsheet application (Excel, Sheets, Numbers) interprets
 * as a formula trigger — `=`, `+`, `-`, `@`, or a leading tab/carriage-return used to smuggle one
 * in — is prefixed with a defusing apostrophe so it always imports as literal text. This applies
 * even to values StationSnap itself generated (names, notes) since a manager or employee display
 * name is untrusted input from the export's point of view.
 */
const FORMULA_TRIGGER_PATTERN = /^[=+\-@\t\r]/;

function sanitizeCsvCell(value: string): string {
  return FORMULA_TRIGGER_PATTERN.test(value) ? `'${value}` : value;
}

function escapeCsvField(raw: unknown): string {
  const value = raw === null || raw === undefined ? "" : String(raw);
  const sanitized = sanitizeCsvCell(value);
  if (/[",\n\r]/.test(sanitized)) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
}

/** Encodes headers and rows as a CRLF-terminated CSV document, escaping and defusing every cell. */
export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvField).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** A `Response` init for downloading a CSV document as an attachment with the given filename. */
export function csvResponseInit(filename: string): ResponseInit & { headers: HeadersInit } {
  return {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      "cache-control": "private, no-store",
    },
  };
}
