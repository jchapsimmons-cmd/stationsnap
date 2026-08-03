import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { getServerEnv } from "@/lib/env";
import { writeAuditEvent } from "@/server/audit";
import { PASSWORD_RESET_TTL_MS } from "@/server/auth/constants";
import {
  createOpaqueToken,
  hashSecret,
  hashToken,
  normalizeEmail,
  verifySecret,
} from "@/server/auth/crypto";
import {
  assertLoginAllowed,
  clearLoginFailures,
  createRateLimitKey,
  recordLoginAttempt,
  recordLoginFailure,
} from "@/server/auth/rate-limit";
import { createEmployeeSession, createManagerSession } from "@/server/auth/sessions";
import { getDb } from "@/server/db/client";
import {
  employeeSessions,
  employees,
  locations,
  managerMemberships,
  managerSessions,
  managerUsers,
  organizations,
  passwordResetTokens,
} from "@/server/db/schema";
import { assertPasswordResetEmailConfigured, sendPasswordResetEmail } from "@/server/email";

interface RequestContext {
  ipHash: string;
  requestId: string;
}

const genericLoginError = "The sign-in details are incorrect.";

export async function loginManager(
  input: { email: string; password: string },
  context: RequestContext,
) {
  const email = normalizeEmail(input.email);
  const subjectHash = hashToken(`manager:${email}`);
  const rateKey = createRateLimitKey("manager", email);

  try {
    await assertLoginAllowed(rateKey);
  } catch (error: unknown) {
    await recordLoginAttempt({
      actorKind: "manager",
      subjectHash,
      ipHash: context.ipHash,
      outcome: "locked",
    });
    await writeAuditEvent({
      actorKind: "anonymous",
      action: "login.locked",
      targetType: "manager_account",
      metadata: { subjectHash },
      requestId: context.requestId,
    });
    throw error;
  }

  const records = await getDb()
    .select({
      userId: managerUsers.id,
      email: managerUsers.email,
      displayName: managerUsers.displayName,
      passwordHash: managerUsers.passwordHash,
      userStatus: managerUsers.status,
      membershipId: managerMemberships.id,
      organizationId: managerMemberships.organizationId,
      membershipStatus: managerMemberships.status,
      organizationStatus: organizations.status,
    })
    .from(managerUsers)
    .innerJoin(managerMemberships, eq(managerMemberships.managerUserId, managerUsers.id))
    .innerJoin(organizations, eq(organizations.id, managerMemberships.organizationId))
    .where(eq(managerUsers.email, email))
    .limit(20);

  const record =
    records.find(
      (candidate) =>
        candidate.userStatus === "active" &&
        candidate.membershipStatus === "active" &&
        candidate.organizationStatus === "active",
    ) ?? records[0];

  const hashToVerify = record?.passwordHash ?? (await hashSecret("invalid-manager-password"));
  const validPassword = await verifySecret(input.password, hashToVerify);
  if (!record || !record.passwordHash || !validPassword) {
    const lockedUntil = await recordLoginFailure(rateKey);
    await recordLoginAttempt({
      organizationId: record?.organizationId,
      actorKind: "manager",
      subjectHash,
      ipHash: context.ipHash,
      outcome: lockedUntil ? "locked" : "failure",
    });
    await writeAuditEvent({
      organizationId: record?.organizationId,
      actorKind: "anonymous",
      action: lockedUntil ? "login.locked" : "login.failed",
      targetType: "manager_account",
      metadata: { subjectHash },
      requestId: context.requestId,
    });
    if (lockedUntil)
      throw new AppError("RATE_LIMITED", "Too many failed attempts. Try again later.");
    throw new AppError("UNAUTHENTICATED", genericLoginError);
  }

  if (
    record.userStatus !== "active" ||
    record.membershipStatus !== "active" ||
    record.organizationStatus !== "active"
  ) {
    await recordLoginAttempt({
      organizationId: record.organizationId,
      actorKind: "manager",
      subjectHash,
      ipHash: context.ipHash,
      outcome: "disabled",
    });
    throw new AppError("FORBIDDEN", "This manager account is disabled.");
  }

  await clearLoginFailures(rateKey);
  await recordLoginAttempt({
    organizationId: record.organizationId,
    actorKind: "manager",
    subjectHash,
    ipHash: context.ipHash,
    outcome: "success",
  });
  const session = await createManagerSession({
    organizationId: record.organizationId,
    membershipId: record.membershipId,
    managerUserId: record.userId,
  });
  await writeAuditEvent({
    organizationId: record.organizationId,
    actorKind: "manager",
    actorId: record.userId,
    action: "manager.login",
    targetType: "manager_session",
    requestId: context.requestId,
  });
  return { ...session, displayName: record.displayName };
}

export async function resolveEmployeeAccess(input: {
  organizationSlug: string;
  locationSlug: string;
}) {
  const [record] = await getDb()
    .select({
      organizationId: organizations.id,
      organizationName: organizations.name,
      locationId: locations.id,
      locationName: locations.name,
    })
    .from(organizations)
    .innerJoin(locations, eq(locations.organizationId, organizations.id))
    .where(
      and(
        eq(organizations.accessSlug, input.organizationSlug.trim().toLowerCase()),
        eq(locations.accessSlug, input.locationSlug.trim().toLowerCase()),
        eq(organizations.status, "active"),
        eq(locations.status, "active"),
      ),
    )
    .limit(1);
  if (!record) throw new AppError("NOT_FOUND", "We couldn’t find that restaurant location.");
  return record;
}

export async function loginEmployee(
  input: { organizationSlug: string; locationSlug: string; employeeNumber: string; pin: string },
  context: RequestContext,
) {
  const access = await resolveEmployeeAccess(input);
  const normalizedNumber = input.employeeNumber.trim();
  const subjectHash = hashToken(`employee:${access.organizationId}:${normalizedNumber}`);
  const rateKey = createRateLimitKey("employee", `${access.organizationId}:${normalizedNumber}`);

  try {
    await assertLoginAllowed(rateKey);
  } catch (error: unknown) {
    await recordLoginAttempt({
      organizationId: access.organizationId,
      actorKind: "employee",
      subjectHash,
      ipHash: context.ipHash,
      outcome: "locked",
    });
    await writeAuditEvent({
      organizationId: access.organizationId,
      locationId: access.locationId,
      actorKind: "anonymous",
      action: "login.locked",
      targetType: "employee_account",
      metadata: { subjectHash },
      requestId: context.requestId,
    });
    throw error;
  }

  const [employee] = await getDb()
    .select({
      id: employees.id,
      displayName: employees.displayName,
      pinHash: employees.pinHash,
      status: employees.status,
    })
    .from(employees)
    .where(
      and(
        eq(employees.organizationId, access.organizationId),
        eq(employees.primaryLocationId, access.locationId),
        eq(employees.employeeNumber, normalizedNumber),
      ),
    )
    .limit(1);
  const hashToVerify = employee?.pinHash ?? (await hashSecret("000000000000"));
  const validPin = await verifySecret(input.pin, hashToVerify);
  if (!employee || !employee.pinHash || !validPin) {
    const lockedUntil = await recordLoginFailure(rateKey);
    await recordLoginAttempt({
      organizationId: access.organizationId,
      actorKind: "employee",
      subjectHash,
      ipHash: context.ipHash,
      outcome: lockedUntil ? "locked" : "failure",
    });
    await writeAuditEvent({
      organizationId: access.organizationId,
      locationId: access.locationId,
      actorKind: "anonymous",
      action: lockedUntil ? "login.locked" : "login.failed",
      targetType: "employee_account",
      metadata: { subjectHash },
      requestId: context.requestId,
    });
    if (lockedUntil)
      throw new AppError("RATE_LIMITED", "Too many failed attempts. Try again later.");
    throw new AppError("UNAUTHENTICATED", genericLoginError);
  }
  if (employee.status !== "active") {
    await recordLoginAttempt({
      organizationId: access.organizationId,
      actorKind: "employee",
      subjectHash,
      ipHash: context.ipHash,
      outcome: "disabled",
    });
    throw new AppError("FORBIDDEN", "This employee account is disabled.");
  }

  await clearLoginFailures(rateKey);
  await recordLoginAttempt({
    organizationId: access.organizationId,
    actorKind: "employee",
    subjectHash,
    ipHash: context.ipHash,
    outcome: "success",
  });
  const session = await createEmployeeSession({
    organizationId: access.organizationId,
    locationId: access.locationId,
    employeeId: employee.id,
  });
  await writeAuditEvent({
    organizationId: access.organizationId,
    locationId: access.locationId,
    actorKind: "employee",
    actorId: employee.id,
    action: "employee.login",
    targetType: "employee_session",
    requestId: context.requestId,
  });
  return { ...session, displayName: employee.displayName };
}

export async function requestManagerPasswordReset(
  emailInput: string,
  requestId: string,
): Promise<void> {
  assertPasswordResetEmailConfigured();
  const email = normalizeEmail(emailInput);
  const [manager] = await getDb()
    .select({
      id: managerUsers.id,
      email: managerUsers.email,
      displayName: managerUsers.displayName,
      status: managerUsers.status,
      organizationId: managerMemberships.organizationId,
    })
    .from(managerUsers)
    .innerJoin(managerMemberships, eq(managerMemberships.managerUserId, managerUsers.id))
    .innerJoin(organizations, eq(organizations.id, managerMemberships.organizationId))
    .where(
      and(
        eq(managerUsers.email, email),
        eq(managerMemberships.status, "active"),
        eq(organizations.status, "active"),
      ),
    )
    .limit(1);
  if (!manager || manager.status !== "active") {
    await hashSecret("password-reset-timing-padding");
    return;
  }

  const token = createOpaqueToken();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
  await getDb()
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(
      and(eq(passwordResetTokens.managerUserId, manager.id), isNull(passwordResetTokens.usedAt)),
    );
  await getDb()
    .insert(passwordResetTokens)
    .values({
      id: randomUUID(),
      managerUserId: manager.id,
      tokenHash: hashToken(token),
      expiresAt,
    });
  const resetUrl = new URL("/manager/recover/confirm", getServerEnv().APP_URL);
  resetUrl.searchParams.set("token", token);
  await sendPasswordResetEmail({
    email: manager.email,
    displayName: manager.displayName,
    resetUrl: resetUrl.toString(),
  });
  await writeAuditEvent({
    organizationId: manager.organizationId,
    actorKind: "manager",
    actorId: manager.id,
    action: "manager.password_reset_requested",
    targetType: "manager_account",
    targetId: manager.id,
    requestId,
  });
}

export async function completeManagerPasswordReset(
  input: { token: string; password: string },
  requestId: string,
): Promise<void> {
  const tokenHash = hashToken(input.token);
  const [record] = await getDb()
    .select({
      id: passwordResetTokens.id,
      managerUserId: passwordResetTokens.managerUserId,
      organizationId: managerMemberships.organizationId,
    })
    .from(passwordResetTokens)
    .innerJoin(managerUsers, eq(managerUsers.id, passwordResetTokens.managerUserId))
    .innerJoin(managerMemberships, eq(managerMemberships.managerUserId, managerUsers.id))
    .innerJoin(organizations, eq(organizations.id, managerMemberships.organizationId))
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
        eq(managerUsers.status, "active"),
        eq(managerMemberships.status, "active"),
        eq(organizations.status, "active"),
      ),
    )
    .limit(1);
  if (!record) throw new AppError("BAD_REQUEST", "This password-reset link is invalid or expired.");
  const passwordHash = await hashSecret(input.password);
  await getDb().transaction(async (tx) => {
    const consumed = await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.id, record.id), isNull(passwordResetTokens.usedAt)))
      .returning({ id: passwordResetTokens.id });
    if (consumed.length === 0) {
      throw new AppError("BAD_REQUEST", "This password-reset link is invalid or expired.");
    }
    await tx
      .update(managerUsers)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(managerUsers.id, record.managerUserId));
    await tx
      .update(managerSessions)
      .set({ revokedAt: new Date() })
      .where(eq(managerSessions.managerUserId, record.managerUserId));
  });
  await writeAuditEvent({
    organizationId: record.organizationId,
    actorKind: "manager",
    actorId: record.managerUserId,
    action: "manager.password_reset_completed",
    targetType: "manager_account",
    targetId: record.managerUserId,
    requestId,
  });
}

export async function revokeEmployeeSessions(employeeId: string): Promise<void> {
  await getDb()
    .update(employeeSessions)
    .set({ revokedAt: new Date() })
    .where(eq(employeeSessions.employeeId, employeeId));
}
