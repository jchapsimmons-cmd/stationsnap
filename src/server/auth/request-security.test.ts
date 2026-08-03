import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { assertSameOrigin, safeReturnTo } from "@/server/auth/request-security";

describe("request security", () => {
  it("accepts same-origin mutations", () => {
    const request = new Request("https://stationsnap.example/api", {
      headers: { host: "stationsnap.example", origin: "https://stationsnap.example" },
    });
    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  it("rejects cross-origin mutations", () => {
    const request = new Request("https://stationsnap.example/api", {
      headers: { host: "stationsnap.example", origin: "https://attacker.example" },
    });
    expect(() => assertSameOrigin(request)).toThrow(AppError);
  });

  it("allows only same-origin relative return destinations", () => {
    expect(safeReturnTo("/employee/sops/abc?step=2", "/employee")).toBe(
      "/employee/sops/abc?step=2",
    );
    expect(safeReturnTo("//attacker.example/path", "/employee")).toBe("/employee");
    expect(safeReturnTo("https://attacker.example", "/employee")).toBe("/employee");
  });
});
