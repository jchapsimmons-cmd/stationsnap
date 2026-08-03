import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { readJson } from "@/lib/request";

describe("readJson", () => {
  it("parses bounded JSON requests", async () => {
    const request = new Request("https://stationsnap.example/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    });
    await expect(readJson(request)).resolves.toEqual({ ok: true });
  });

  it("rejects invalid content types and malformed JSON", async () => {
    await expect(
      readJson(
        new Request("https://stationsnap.example/api", {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: "{}",
        }),
      ),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      readJson(
        new Request("https://stationsnap.example/api", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "not-json",
        }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects oversized bodies", async () => {
    const request = new Request("https://stationsnap.example/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(100) }),
    });
    await expect(readJson(request, 32)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
