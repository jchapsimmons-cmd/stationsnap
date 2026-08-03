import { randomUUID } from "node:crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { hashToken } from "@/server/auth/crypto";
import { LOGIN_LOCKOUT_MS, LOGIN_WINDOW_MS, MAX_LOGIN_FAILURES } from "@/server/auth/constants";
import { getDb } from "@/server/db/client";
import { authRateLimits, loginAttempts } from "@/server/db/schema";

export function createRateLimitKey(kind: "manager" | "employee", subject: string): string {
  return hashToken(`${kind}:${subject.trim().toLowerCase()}`);
}

export async function assertLoginAllowed(keyHash: string, now = new Date()): Promise<void> {
  const [record] = await getDb()
    .select()
    .from(authRateLimits)
    .where(eq(authRateLimits.keyHash, keyHash))
    .limit(1);
  if (record?.lockedUntil && record.lockedUntil > now) {
    throw new AppError("RATE_LIMITED", "Too many failed attempts. Try again later.", {
      details: {
        retryAfterSeconds: Math.ceil((record.lockedUntil.getTime() - now.getTime()) / 1000),
      },
    });
  }
}

export async function recordLoginFailure(keyHash: string, now = new Date()): Promise<Date | null> {
  const windowStart = new Date(now.getTime() - LOGIN_WINDOW_MS);
  const lockedUntil = new Date(now.getTime() + LOGIN_LOCKOUT_MS);
  return getDb().transaction(async (tx) => {
    const inserted = await tx
      .insert(authRateLimits)
      .values({ keyHash, failures: 1, windowStartedAt: now, updatedAt: now })
      .onConflictDoNothing()
      .returning({ keyHash: authRateLimits.keyHash });
    if (inserted.length > 0) return null;

    const [record] = await tx
      .select()
      .from(authRateLimits)
      .where(eq(authRateLimits.keyHash, keyHash))
      .for("update")
      .limit(1);
    if (!record) return null;

    const insideWindow = record.windowStartedAt >= windowStart;
    const failures = insideWindow ? record.failures + 1 : 1;
    const nextLockedUntil = failures >= MAX_LOGIN_FAILURES ? lockedUntil : null;
    await tx
      .update(authRateLimits)
      .set({
        failures,
        windowStartedAt: insideWindow ? record.windowStartedAt : now,
        lockedUntil: nextLockedUntil,
        updatedAt: now,
      })
      .where(eq(authRateLimits.keyHash, keyHash));
    return nextLockedUntil;
  });
}

export async function clearLoginFailures(keyHash: string): Promise<void> {
  await getDb().delete(authRateLimits).where(eq(authRateLimits.keyHash, keyHash));
}

export async function recordLoginAttempt(input: {
  organizationId?: string;
  actorKind: "manager" | "employee";
  subjectHash: string;
  ipHash: string;
  outcome: "success" | "failure" | "locked" | "disabled";
}): Promise<void> {
  await getDb()
    .insert(loginAttempts)
    .values({ id: randomUUID(), ...input });
}

export async function removeExpiredRateLimits(now = new Date()): Promise<void> {
  await getDb()
    .delete(authRateLimits)
    .where(
      and(
        lt(authRateLimits.updatedAt, new Date(now.getTime() - LOGIN_WINDOW_MS)),
        or(isNull(authRateLimits.lockedUntil), lt(authRateLimits.lockedUntil, now)),
      ),
    );
}
