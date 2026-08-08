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

  it("requires Twilio settings as a complete group", () => {
    expect(() =>
      parseServerEnv({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://user:password@localhost/stationsnap",
        TWILIO_ACCOUNT_SID: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      }),
    ).toThrow(/TWILIO_ACCOUNT_SID.*must be configured together/);
  });

  it("rejects a non-E.164 Twilio from-number", () => {
    expect(() =>
      parseServerEnv({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://user:password@localhost/stationsnap",
        TWILIO_ACCOUNT_SID: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        TWILIO_API_KEY_SID: "SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        TWILIO_API_KEY_SECRET: "secret",
        TWILIO_FROM_NUMBER: "555-123-4567",
      }),
    ).toThrow(/TWILIO_FROM_NUMBER must be in E\.164 format/);
  });

  it("accepts a fully configured Twilio group", () => {
    expect(
      parseServerEnv({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://user:password@localhost/stationsnap",
        TWILIO_ACCOUNT_SID: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        TWILIO_API_KEY_SID: "SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        TWILIO_API_KEY_SECRET: "secret",
        TWILIO_FROM_NUMBER: "+15551234567",
      }),
    ).toMatchObject({ TWILIO_FROM_NUMBER: "+15551234567" });
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

  it("defaults APP_URL to localhost outside production", () => {
    expect(
      parseServerEnv({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://user:password@localhost/stationsnap",
      }),
    ).toMatchObject({ APP_URL: "http://localhost:3000" });
  });

  it("rejects a missing APP_URL in production", () => {
    expect(() =>
      parseServerEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://user:password@localhost/stationsnap",
        STORAGE_DRIVER: "vercel-blob",
        BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test_token",
      }),
    ).toThrow(/APP_URL must be set explicitly in production/);
  });

  it("rejects a non-https APP_URL in production", () => {
    expect(() =>
      parseServerEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://user:password@localhost/stationsnap",
        APP_URL: "http://stationsnap.example.com",
        STORAGE_DRIVER: "vercel-blob",
        BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test_token",
      }),
    ).toThrow(/APP_URL must use https/);
  });

  it("rejects local storage in production", () => {
    expect(() =>
      parseServerEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://user:password@localhost/stationsnap",
        APP_URL: "https://stationsnap.example.com",
        STORAGE_DRIVER: "local",
      }),
    ).toThrow(/STORAGE_DRIVER must be vercel-blob in production/);
  });

  it("accepts a fully configured production environment", () => {
    expect(
      parseServerEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://user:password@localhost/stationsnap",
        APP_URL: "https://stationsnap.example.com",
        STORAGE_DRIVER: "vercel-blob",
        BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test_token",
      }),
    ).toMatchObject({
      NODE_ENV: "production",
      APP_URL: "https://stationsnap.example.com",
      STORAGE_DRIVER: "vercel-blob",
    });
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
