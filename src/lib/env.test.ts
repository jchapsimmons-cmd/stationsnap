import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/lib/env";

describe("parseServerEnv", () => {
  it("parses a valid PostgreSQL environment", () => {
    expect(
      parseServerEnv({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://user:password@localhost:5432/stationsnap_test",
        APP_URL: "http://localhost:3000",
        LOG_LEVEL: "silent",
      }),
    ).toMatchObject({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  });

  it("reports missing database configuration clearly", () => {
    expect(() => parseServerEnv({ NODE_ENV: "test" })).toThrow(
      /Invalid server environment: DATABASE_URL/,
    );
  });

  it("rejects a non-PostgreSQL database URL", () => {
    expect(() =>
      parseServerEnv({ NODE_ENV: "test", DATABASE_URL: "mysql://localhost/stationsnap" }),
    ).toThrow(/must be a PostgreSQL connection URL/);
  });
});
