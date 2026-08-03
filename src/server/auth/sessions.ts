import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  EMPLOYEE_SESSION_COOKIE,
  EMPLOYEE_SESSION_TTL_MS,
  MANAGER_SESSION_COOKIE,
  MANAGER_SESSION_TTL_MS,
} from "@/server/auth/constants";
import { createOpaqueToken, hashToken } from "@/server/auth/crypto";
import { getDb } from "@/server/db/client";
import {
  employeeSessions,
  employees,
  locations,
  managerMemberships,
  managerSessions,
  managerUsers,
  organizations,
} from "@/server/db/schema";

export interface ManagerSessionContext {
  sessionId: string;
  organizationId: string;
  membershipId: string;
  managerUserId: string;
  displayName: string;
  email: string;
  role: "owner" | "manager";
  expiresAt: Date;
}

export interface EmployeeSessionContext {
  sessionId: string;
  organizationId: string;
  locationId: string;
  employeeId: string;
  displayName: string;
  employeeNumber: string;
  expiresAt: Date;
}

export async function createManagerSession(input: {
  organizationId: string;
  membershipId: string;
  managerUserId: string;
  now?: Date;
}): Promise<{ token: string; expiresAt: Date }> {
  const now = input.now ?? new Date();
  const token = createOpaqueToken();
  const expiresAt = new Date(now.getTime() + MANAGER_SESSION_TTL_MS);
  await getDb()
    .insert(managerSessions)
    .values({
      id: randomUUID(),
      organizationId: input.organizationId,
      membershipId: input.membershipId,
      managerUserId: input.managerUserId,
      tokenHash: hashToken(token),
      expiresAt,
      lastSeenAt: now,
      createdAt: now,
    });
  return { token, expiresAt };
}

export async function createEmployeeSession(input: {
  organizationId: string;
  locationId: string;
  employeeId: string;
  now?: Date;
}): Promise<{ token: string; expiresAt: Date }> {
  const now = input.now ?? new Date();
  const token = createOpaqueToken();
  const expiresAt = new Date(now.getTime() + EMPLOYEE_SESSION_TTL_MS);
  await getDb()
    .insert(employeeSessions)
    .values({
      id: randomUUID(),
      organizationId: input.organizationId,
      locationId: input.locationId,
      employeeId: input.employeeId,
      tokenHash: hashToken(token),
      expiresAt,
      lastSeenAt: now,
      createdAt: now,
    });
  return { token, expiresAt };
}

export async function getManagerSession(
  token: string,
  now = new Date(),
): Promise<ManagerSessionContext | null> {
  const [row] = await getDb()
    .select({
      sessionId: managerSessions.id,
      organizationId: managerSessions.organizationId,
      membershipId: managerSessions.membershipId,
      managerUserId: managerSessions.managerUserId,
      displayName: managerUsers.displayName,
      email: managerUsers.email,
      role: managerMemberships.role,
      expiresAt: managerSessions.expiresAt,
    })
    .from(managerSessions)
    .innerJoin(managerUsers, eq(managerUsers.id, managerSessions.managerUserId))
    .innerJoin(managerMemberships, eq(managerMemberships.id, managerSessions.membershipId))
    .innerJoin(organizations, eq(organizations.id, managerSessions.organizationId))
    .where(
      and(
        eq(managerSessions.tokenHash, hashToken(token)),
        isNull(managerSessions.revokedAt),
        gt(managerSessions.expiresAt, now),
        eq(managerUsers.status, "active"),
        eq(managerMemberships.status, "active"),
        eq(organizations.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getEmployeeSession(
  token: string,
  now = new Date(),
): Promise<EmployeeSessionContext | null> {
  const [row] = await getDb()
    .select({
      sessionId: employeeSessions.id,
      organizationId: employeeSessions.organizationId,
      locationId: employeeSessions.locationId,
      employeeId: employeeSessions.employeeId,
      displayName: employees.displayName,
      employeeNumber: employees.employeeNumber,
      expiresAt: employeeSessions.expiresAt,
    })
    .from(employeeSessions)
    .innerJoin(employees, eq(employees.id, employeeSessions.employeeId))
    .innerJoin(organizations, eq(organizations.id, employeeSessions.organizationId))
    .innerJoin(locations, eq(locations.id, employeeSessions.locationId))
    .where(
      and(
        eq(employeeSessions.tokenHash, hashToken(token)),
        isNull(employeeSessions.revokedAt),
        gt(employeeSessions.expiresAt, now),
        eq(employees.status, "active"),
        eq(organizations.status, "active"),
        eq(locations.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getCurrentManagerSession(): Promise<ManagerSessionContext | null> {
  const token = (await cookies()).get(MANAGER_SESSION_COOKIE)?.value;
  return token ? getManagerSession(token) : null;
}

export async function getCurrentEmployeeSession(): Promise<EmployeeSessionContext | null> {
  const token = (await cookies()).get(EMPLOYEE_SESSION_COOKIE)?.value;
  return token ? getEmployeeSession(token) : null;
}

export async function revokeManagerSession(token: string, now = new Date()): Promise<void> {
  await getDb()
    .update(managerSessions)
    .set({ revokedAt: now })
    .where(eq(managerSessions.tokenHash, hashToken(token)));
}

export async function revokeEmployeeSession(token: string, now = new Date()): Promise<void> {
  await getDb()
    .update(employeeSessions)
    .set({ revokedAt: now })
    .where(eq(employeeSessions.tokenHash, hashToken(token)));
}

function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

export function setManagerSessionCookie(
  response: NextResponse,
  token: string,
  expiresAt: Date,
): void {
  response.cookies.set(MANAGER_SESSION_COOKIE, token, cookieOptions(expiresAt));
}

export function setEmployeeSessionCookie(
  response: NextResponse,
  token: string,
  expiresAt: Date,
): void {
  response.cookies.set(EMPLOYEE_SESSION_COOKIE, token, cookieOptions(expiresAt));
}

export function clearManagerSessionCookie(response: NextResponse): void {
  response.cookies.set(MANAGER_SESSION_COOKIE, "", cookieOptions(new Date(0)));
}

export function clearEmployeeSessionCookie(response: NextResponse): void {
  response.cookies.set(EMPLOYEE_SESSION_COOKIE, "", cookieOptions(new Date(0)));
}
