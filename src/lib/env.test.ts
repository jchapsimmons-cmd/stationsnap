import { describe, expect, it } from "vitest";
import { parseSeedEnv, parseServerEnv } from "@/lib/env";

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

  it("requires SMTP settings as a complete group", () => {
    expect(() =>
      parseServerEnv({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://user:password@localhost/stationsnap",
        SMTP_HOST: "smtp.example.com",
      }),
    ).toThrow(/must be configured together/);
  });

  it("defaults to local storage and requires a token for vercel-blob", () => {
    expect(
      parseServerEnv({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://user:password@localhost/stationsnap",
      }),
    ).toMatchObject({ STORAGE_DRIVER: "local" });
    expect(() =>
      parseServerEnv({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://user:password@localhost/stationsnap",
        STORAGE_DRIVER: "vercel-blob",
      }),
    ).toThrow(/BLOB_READ_WRITE_TOKEN is required/);
    expect(
      parseServerEnv({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://user:password@localhost/stationsnap",
        STORAGE_DRIVER: "vercel-blob",
        BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test_token",
      }),
    ).toMatchObject({ STORAGE_DRIVER: "vercel-blob" });
  });

  it("allows seed credentials only outside production", () => {
    expect(
      parseSeedEnv({
        NODE_ENV: "test",
        SEED_MANAGER_PASSWORD: "long-development-password",
        SEED_EMPLOYEE_PIN: "4826",
      }),
    ).toMatchObject({ NODE_ENV: "test" });
    expect(() =>
      parseSeedEnv({
        NODE_ENV: "production",
        SEED_MANAGER_PASSWORD: "long-development-password",
        SEED_EMPLOYEE_PIN: "4826",
      }),
    ).toThrow(/Invalid seed environment/);
  });
});
