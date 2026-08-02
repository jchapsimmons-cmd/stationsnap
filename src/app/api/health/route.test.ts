import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();

vi.mock("@/server/db/client", () => ({
  getDb: () => ({ execute }),
}));

vi.mock("@/server/logger", () => ({
  logger: { error: vi.fn() },
}));

import { GET } from "@/app/api/health/route";

describe("health endpoint", () => {
  beforeEach(() => execute.mockReset());

  it("reports a healthy database", async () => {
    execute.mockResolvedValueOnce({ rows: [{ ok: 1 }] });
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, data: { status: "healthy", database: "connected" } });
  });

  it("returns a safe unavailable response", async () => {
    execute.mockRejectedValueOnce(new Error("postgresql://user:secret@private-host/database"));
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(body).toMatchObject({
      ok: false,
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Application dependencies are unavailable.",
      },
    });
  });
});
