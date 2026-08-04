import { describe, expect, it } from "vitest";
import { csvResponseInit, toCsv } from "@/lib/csv";

describe("toCsv", () => {
  it("joins headers and rows with commas and CRLF line endings", () => {
    const csv = toCsv(
      ["Name", "Score"],
      [
        ["Ada Lovelace", 92],
        ["Grace Hopper", 88],
      ],
    );
    expect(csv).toBe("Name,Score\r\nAda Lovelace,92\r\nGrace Hopper,88\r\n");
  });

  it("quotes and escapes fields containing commas, quotes, or newlines", () => {
    const csv = toCsv(["Note"], [['Say "hi", then\nnew line']]);
    expect(csv).toBe('Note\r\n"Say ""hi"", then\nnew line"\r\n');
  });

  it("renders null and undefined cells as empty strings", () => {
    const csv = toCsv(["A", "B"], [[null, undefined]]);
    expect(csv).toBe("A,B\r\n,\r\n");
  });

  it("defuses a leading equals sign to prevent formula injection", () => {
    const csv = toCsv(["Note"], [["=cmd|'/c calc'!A1"]]);
    expect(csv).toBe("Note\r\n'=cmd|'/c calc'!A1\r\n");
  });

  it("defuses every other formula-trigger character spreadsheet apps recognize", () => {
    for (const trigger of ["+1", "-1", "@SUM(A1)"]) {
      const csv = toCsv(["Note"], [[trigger]]);
      expect(csv).toBe(`Note\r\n'${trigger}\r\n`);
    }
  });

  it("defuses a formula trigger even after it round-trips through quoting", () => {
    const csv = toCsv(["Note"], [['=HYPERLINK("http://evil","click")']]);
    expect(csv).toContain("\"'=HYPERLINK");
  });

  it("leaves ordinary text starting with a hyphenated word alone in spirit but still defuses it", () => {
    // A cell that is genuinely just "-5% variance" still starts with the trigger character, so
    // it is defused too — the safety rule cannot tell intent from formula syntax, by design.
    const csv = toCsv(["Note"], [["-5% variance"]]);
    expect(csv).toBe("Note\r\n'-5% variance\r\n");
  });

  it("does not alter values that do not start with a trigger character", () => {
    const csv = toCsv(["Note"], [["Passed (92%)"]]);
    expect(csv).toBe("Note\r\nPassed (92%)\r\n");
  });
});

describe("csvResponseInit", () => {
  it("sets a CSV content type and attachment disposition with the given filename", () => {
    const init = csvResponseInit("training-progress.csv");
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(headers["content-disposition"]).toBe('attachment; filename="training-progress.csv"');
  });

  it("strips quote characters out of an attacker-influenced filename", () => {
    const init = csvResponseInit('evil".csv"; filename="other.csv');
    const headers = init.headers as Record<string, string>;
    expect(headers["content-disposition"]).not.toContain('""');
    expect(headers["content-disposition"]).toBe(
      'attachment; filename="evil.csv; filename=other.csv"',
    );
  });
});
