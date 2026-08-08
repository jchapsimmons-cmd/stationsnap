import { AppError } from "@/lib/errors";
import { getServerEnv } from "@/lib/env";

function getTwilioConfig(): {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  fromNumber: string;
} {
  const env = getServerEnv();
  if (
    !env.TWILIO_ACCOUNT_SID ||
    !env.TWILIO_API_KEY_SID ||
    !env.TWILIO_API_KEY_SECRET ||
    !env.TWILIO_FROM_NUMBER
  ) {
    throw new AppError("SERVICE_UNAVAILABLE", "Outbound SMS is not configured.");
  }
  return {
    accountSid: env.TWILIO_ACCOUNT_SID,
    apiKeySid: env.TWILIO_API_KEY_SID,
    apiKeySecret: env.TWILIO_API_KEY_SECRET,
    fromNumber: env.TWILIO_FROM_NUMBER,
  };
}

/** Whether Twilio is configured at all, without throwing — mirrors
 * `isEmailDeliveryConfigured()`; the Phase 20 SMS channel treats "not configured" as a normal,
 * recorded `skipped` outcome rather than a failure. */
export function isSmsDeliveryConfigured(): boolean {
  const env = getServerEnv();
  return Boolean(
    env.TWILIO_ACCOUNT_SID &&
    env.TWILIO_API_KEY_SID &&
    env.TWILIO_API_KEY_SECRET &&
    env.TWILIO_FROM_NUMBER,
  );
}

/**
 * Sends one SMS via Twilio's Messages REST API, authenticated with an API Key (SID as the Basic
 * Auth username, Secret as the password) rather than the account's primary Auth Token, per the
 * project owner's resolved decision. Deliberately a thin `fetch` call rather than the `twilio`
 * SDK — this is the only Twilio call site in the app, so a new dependency is not worth it. Callers
 * must check `isSmsDeliveryConfigured()` first; this throws `SERVICE_UNAVAILABLE` otherwise,
 * exactly like `sendNotificationEmail`. Never call this from a test — see `docs/testing-plan.md`'s
 * "provider fakes" principle; test code should replace this module entirely rather than let a real
 * network call reach Twilio.
 */
export async function sendNotificationSms(input: { to: string; body: string }): Promise<void> {
  const twilio = getTwilioConfig();
  const credentials = Buffer.from(`${twilio.apiKeySid}:${twilio.apiKeySecret}`).toString("base64");
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${twilio.accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${credentials}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: input.to,
        From: twilio.fromNumber,
        Body: input.body,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    // Twilio's error body can include account-identifying details; never log or propagate it.
    throw new AppError("SERVICE_UNAVAILABLE", "SMS delivery failed.");
  }
}
