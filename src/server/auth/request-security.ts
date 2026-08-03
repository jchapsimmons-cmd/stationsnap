import { AppError } from "@/lib/errors";
import { hashToken } from "@/server/auth/crypto";

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) throw new AppError("FORBIDDEN", "Request origin could not be verified.");

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError("FORBIDDEN", "Request origin could not be verified.");
  }
  if (originHost !== host) throw new AppError("FORBIDDEN", "Request origin could not be verified.");
}

export function getRequestFingerprint(request: Request): { ipHash: string; requestId: string } {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  return { ipHash: hashToken(`ip:${ip}`), requestId };
}

export function safeReturnTo(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//"))
    return fallback;
  try {
    const url = new URL(value, "http://stationsnap.local");
    return url.origin === "http://stationsnap.local"
      ? `${url.pathname}${url.search}${url.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}
