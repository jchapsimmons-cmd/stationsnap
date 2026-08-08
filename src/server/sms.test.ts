import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";

const configuredEnv = {
  TWILIO_ACCOUNT_SID: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  TWILIO_API_KEY_SID: "SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  TWILIO_API_KEY_SECRET: "test-secret",
  TWILIO_FROM_NUMBER: "+15550000000",
};

vi.mock("@/lib/env", () => ({
  getServerEnv: vi.fn(),
}));

// A provider fake per docs/testing-plan.md's principle: this suite never reaches the real
// Twilio API. `fetch` is stubbed globally so `sendNotificationSms` is exercised end to end
// (request shape, auth header, success/failure handling) without any network call.
describe("sms provider (Twilio, faked)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("reports not configured when any Twilio setting is missing", async () => {
    const { getServerEnv } = await import("@/lib/env");
    vi.mocked(getServerEnv).mockReturnValue({} as ReturnType<typeof getServerEnv>);
    const { isSmsDeliveryConfigured } = await import("@/server/sms");
    expect(isSmsDeliveryConfigured()).toBe(false);
  });

  it("reports configured once all four Twilio settings are present", async () => {
    const { getServerEnv } = await import("@/lib/env");
    vi.mocked(getServerEnv).mockReturnValue(configuredEnv as ReturnType<typeof getServerEnv>);
    const { isSmsDeliveryConfigured } = await import("@/server/sms");
    expect(isSmsDeliveryConfigured()).toBe(true);
  });

  it("throws SERVICE_UNAVAILABLE without calling fetch when not configured", async () => {
    const { getServerEnv } = await import("@/lib/env");
    vi.mocked(getServerEnv).mockReturnValue({} as ReturnType<typeof getServerEnv>);
    const { sendNotificationSms } = await import("@/server/sms");
    await expect(sendNotificationSms({ to: "+15551234567", body: "hi" })).rejects.toThrow(AppError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts to Twilio's Messages API with API-Key basic auth on success", async () => {
    const { getServerEnv } = await import("@/lib/env");
    vi.mocked(getServerEnv).mockReturnValue(configuredEnv as ReturnType<typeof getServerEnv>);
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 201 }));
    const { sendNotificationSms } = await import("@/server/sms");

    await sendNotificationSms({ to: "+15551234567", body: "Your shift starts soon" });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/${configuredEnv.TWILIO_ACCOUNT_SID}/Messages.json`,
    );
    const headers = init?.headers as Record<string, string>;
    expect(headers["authorization"]).toBe(
      `Basic ${Buffer.from(`${configuredEnv.TWILIO_API_KEY_SID}:${configuredEnv.TWILIO_API_KEY_SECRET}`).toString("base64")}`,
    );
    const body = new URLSearchParams(init?.body as string);
    expect(body.get("To")).toBe("+15551234567");
    expect(body.get("From")).toBe(configuredEnv.TWILIO_FROM_NUMBER);
    expect(body.get("Body")).toBe("Your shift starts soon");
  });

  it("throws SERVICE_UNAVAILABLE without leaking the provider response on a failed send", async () => {
    const { getServerEnv } = await import("@/lib/env");
    vi.mocked(getServerEnv).mockReturnValue(configuredEnv as ReturnType<typeof getServerEnv>);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: "account-identifying detail" }), { status: 400 }),
    );
    const { sendNotificationSms } = await import("@/server/sms");

    let caught: unknown;
    try {
      await sendNotificationSms({ to: "+15551234567", body: "hi" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect(String((caught as AppError).message)).not.toContain("account-identifying");
  });
});
