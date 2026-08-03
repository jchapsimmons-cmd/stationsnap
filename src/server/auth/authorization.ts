import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AppError } from "@/lib/errors";
import { writeAuditEvent } from "@/server/audit";
import {
  getCurrentEmployeeSession,
  getCurrentManagerSession,
  type EmployeeSessionContext,
  type ManagerSessionContext,
} from "@/server/auth/sessions";
import { getDb } from "@/server/db/client";
import { locations, managerLocationAccess } from "@/server/db/schema";

export async function requireManagerPage(returnTo: string): Promise<ManagerSessionContext> {
  const session = await getCurrentManagerSession();
  if (!session) redirect(`/manager/login?returnTo=${encodeURIComponent(returnTo)}`);
  return session;
}

export async function requireEmployeePage(returnTo: string): Promise<EmployeeSessionContext> {
  const session = await getCurrentEmployeeSession();
  if (!session) redirect(`/employee/access?returnTo=${encodeURIComponent(returnTo)}`);
  return session;
}

export async function requireManager(requestId?: string): Promise<ManagerSessionContext> {
  const session = await getCurrentManagerSession();
  if (!session) {
    await writeAuditEvent({
      actorKind: "anonymous",
      action: "access.unauthorized",
      targetType: "manager_route",
      requestId,
    });
    throw new AppError("UNAUTHENTICATED", "Manager sign-in is required.");
  }
  return session;
}

export async function requireEmployee(requestId?: string): Promise<EmployeeSessionContext> {
  const session = await getCurrentEmployeeSession();
  if (!session) {
    await writeAuditEvent({
      actorKind: "anonymous",
      action: "access.unauthorized",
      targetType: "employee_route",
      requestId,
    });
    throw new AppError("UNAUTHENTICATED", "Employee sign-in is required.");
  }
  return session;
}

export async function requireOwner(
  session: ManagerSessionContext,
  requestId?: string,
): Promise<void> {
  if (session.role === "owner") return;
  await auditUnauthorized(session, "organization", session.organizationId, requestId);
  throw new AppError("FORBIDDEN", "Owner access is required.");
}

export async function managerCanAccessLocation(
  session: ManagerSessionContext,
  locationId: string,
): Promise<boolean> {
  const [location] = await getDb()
    .select({ id: locations.id })
    .from(locations)
    .where(
      and(
        eq(locations.id, locationId),
        eq(locations.organizationId, session.organizationId),
        eq(locations.status, "active"),
      ),
    )
    .limit(1);
  if (!location) return false;
  if (session.role === "owner") return true;
  const [grant] = await getDb()
    .select({ locationId: managerLocationAccess.locationId })
    .from(managerLocationAccess)
    .where(
      and(
        eq(managerLocationAccess.organizationId, session.organizationId),
        eq(managerLocationAccess.membershipId, session.membershipId),
        eq(managerLocationAccess.locationId, locationId),
      ),
    )
    .limit(1);
  return Boolean(grant);
}

export async function requireManagerLocation(
  session: ManagerSessionContext,
  locationId: string,
  requestId?: string,
): Promise<void> {
  if (await managerCanAccessLocation(session, locationId)) return;
  await auditUnauthorized(session, "location", locationId, requestId);
  throw new AppError("FORBIDDEN", "You do not have access to this location.");
}

export async function requireEmployeeLocation(
  session: EmployeeSessionContext,
  organizationId: string,
  locationId: string,
  requestId?: string,
): Promise<void> {
  if (session.organizationId === organizationId && session.locationId === locationId) return;
  await writeAuditEvent({
    organizationId: session.organizationId,
    locationId: session.locationId,
    actorKind: "employee",
    actorId: session.employeeId,
    action: "access.unauthorized",
    targetType: "location",
    metadata: { requestedOrganizationId: organizationId, requestedLocationId: locationId },
    requestId,
  });
  throw new AppError("FORBIDDEN", "You do not have access to this location.");
}

async function auditUnauthorized(
  session: ManagerSessionContext,
  targetType: string,
  targetId: string,
  requestId?: string,
): Promise<void> {
  await writeAuditEvent({
    organizationId: session.organizationId,
    actorKind: "manager",
    actorId: session.managerUserId,
    action: "access.unauthorized",
    targetType,
    targetId,
    requestId,
  });
}
