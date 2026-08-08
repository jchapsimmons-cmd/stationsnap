import { randomUUID } from "node:crypto";
import { and, asc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { writeAuditEvent, type AuditAction } from "@/server/audit";
import { requireManagerManagedLocation, requireOwner } from "@/server/auth/authorization";
import { hashSecret } from "@/server/auth/crypto";
import { revokeEmployeeSessions } from "@/server/auth/service";
import type { EmployeeSessionContext, ManagerSessionContext } from "@/server/auth/sessions";
import { getDb } from "@/server/db/client";
import {
  employees,
  locations,
  managerLocationAccess,
  managerMemberships,
  managerUsers,
  organizations,
  stations,
} from "@/server/db/schema";
import type {
  EmployeeCreateInput,
  EmployeeQuery,
  EmployeeUpdateInput,
  LocationCreateInput,
  LocationUpdateInput,
  OrganizationUpdateInput,
  StationCreateInput,
  StationQuery,
  StationUpdateInput,
} from "@/server/management/schemas";

function postgresCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? postgresCode(error.cause) : undefined;
}

async function mapConflicts<T>(operation: () => Promise<T>, message: string): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (postgresCode(error) === "23505") throw new AppError("CONFLICT", message);
    throw error;
  }
}

async function auditMutation(
  actor: ManagerSessionContext,
  action: AuditAction,
  targetType: string,
  targetId: string,
  locationId?: string,
  requestId?: string,
): Promise<void> {
  await writeAuditEvent({
    organizationId: actor.organizationId,
    locationId,
    actorKind: "manager",
    actorId: actor.managerUserId,
    action,
    targetType,
    targetId,
    requestId,
  });
}

export async function requireActiveManagedLocation(
  actor: ManagerSessionContext,
  locationId: string,
  requestId?: string,
): Promise<void> {
  await requireManagerManagedLocation(actor, locationId, requestId);
  const [location] = await getDb()
    .select({ status: locations.status })
    .from(locations)
    .where(and(eq(locations.id, locationId), eq(locations.organizationId, actor.organizationId)))
    .limit(1);
  if (!location || location.status !== "active") {
    throw new AppError("CONFLICT", "Choose an active location.");
  }
}

export async function getManagedLocationIds(actor: ManagerSessionContext): Promise<string[]> {
  if (actor.role === "owner") {
    const rows = await getDb()
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.organizationId, actor.organizationId));
    return rows.map((row) => row.id);
  }
  const rows = await getDb()
    .select({ id: managerLocationAccess.locationId })
    .from(managerLocationAccess)
    .where(
      and(
        eq(managerLocationAccess.organizationId, actor.organizationId),
        eq(managerLocationAccess.membershipId, actor.membershipId),
      ),
    );
  return rows.map((row) => row.id);
}

/**
 * The inverse of `getManagedLocationIds`: every active manager (owner or explicitly granted
 * manager) who can manage the given location, for Phase 16 notification fan-out. Owners are
 * included regardless of `manager_location_access` since they manage every location implicitly;
 * a disabled manager membership or manager user is excluded so disabled recipients never receive
 * a notification.
 */
export async function getLocationRecipientManagers(
  organizationId: string,
  locationId: string,
): Promise<{ membershipId: string; managerUserId: string; displayName: string; email: string }[]> {
  const rows = await getDb()
    .select({
      membershipId: managerMemberships.id,
      managerUserId: managerUsers.id,
      displayName: managerUsers.displayName,
      email: managerUsers.email,
      role: managerMemberships.role,
      grantedLocationId: managerLocationAccess.locationId,
    })
    .from(managerMemberships)
    .innerJoin(managerUsers, eq(managerUsers.id, managerMemberships.managerUserId))
    .leftJoin(
      managerLocationAccess,
      and(
        eq(managerLocationAccess.membershipId, managerMemberships.id),
        eq(managerLocationAccess.organizationId, managerMemberships.organizationId),
        eq(managerLocationAccess.locationId, locationId),
      ),
    )
    .where(
      and(
        eq(managerMemberships.organizationId, organizationId),
        eq(managerMemberships.status, "active"),
        eq(managerUsers.status, "active"),
        or(eq(managerMemberships.role, "owner"), eq(managerLocationAccess.locationId, locationId)),
      ),
    );
  return rows.map((row) => ({
    membershipId: row.membershipId,
    managerUserId: row.managerUserId,
    displayName: row.displayName,
    email: row.email,
  }));
}

export async function getOrganization(actor: ManagerSessionContext) {
  const [row] = await getDb()
    .select()
    .from(organizations)
    .where(eq(organizations.id, actor.organizationId))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Organization not found.");
  return row;
}

export async function updateOrganization(
  actor: ManagerSessionContext,
  input: OrganizationUpdateInput,
  requestId?: string,
) {
  await requireOwner(actor, requestId);
  const [row] = await getDb()
    .update(organizations)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(organizations.id, actor.organizationId))
    .returning();
  if (!row) throw new AppError("NOT_FOUND", "Organization not found.");
  await auditMutation(actor, "organization.updated", "organization", row.id, undefined, requestId);
  return row;
}

export async function listLocations(actor: ManagerSessionContext) {
  const locationIds = await getManagedLocationIds(actor);
  if (locationIds.length === 0) return [];
  return getDb()
    .select()
    .from(locations)
    .where(
      and(eq(locations.organizationId, actor.organizationId), inArray(locations.id, locationIds)),
    )
    .orderBy(asc(locations.name));
}

export async function getLocation(actor: ManagerSessionContext, locationId: string) {
  await requireManagerManagedLocation(actor, locationId);
  const [row] = await getDb()
    .select()
    .from(locations)
    .where(and(eq(locations.id, locationId), eq(locations.organizationId, actor.organizationId)))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Location not found.");
  return row;
}

export async function createLocation(
  actor: ManagerSessionContext,
  input: LocationCreateInput,
  requestId?: string,
) {
  await requireOwner(actor, requestId);
  const [row] = await mapConflicts(
    () =>
      getDb()
        .insert(locations)
        .values({ id: randomUUID(), organizationId: actor.organizationId, ...input })
        .returning(),
    "A location with that name or access code already exists.",
  );
  if (!row) throw new AppError("INTERNAL_ERROR", "Location could not be created.");
  await auditMutation(actor, "location.created", "location", row.id, row.id, requestId);
  return row;
}

export async function updateLocation(
  actor: ManagerSessionContext,
  locationId: string,
  input: LocationUpdateInput,
  requestId?: string,
) {
  await requireManagerManagedLocation(actor, locationId, requestId);
  const [row] = await mapConflicts(
    () =>
      getDb()
        .update(locations)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(eq(locations.id, locationId), eq(locations.organizationId, actor.organizationId)),
        )
        .returning(),
    "A location with that name or access code already exists.",
  );
  if (!row) throw new AppError("NOT_FOUND", "Location not found.");
  await auditMutation(
    actor,
    row.status === "disabled" ? "location.disabled" : "location.updated",
    "location",
    row.id,
    row.id,
    requestId,
  );
  return row;
}

export async function listStations(actor: ManagerSessionContext, query: StationQuery) {
  const managedIds = await getManagedLocationIds(actor);
  if (managedIds.length === 0) return [];
  const conditions: SQL[] = [
    eq(stations.organizationId, actor.organizationId),
    inArray(stations.locationId, managedIds),
  ];
  if (query.locationId) {
    if (!managedIds.includes(query.locationId)) return [];
    conditions.push(eq(stations.locationId, query.locationId));
  }
  if (query.status) conditions.push(eq(stations.status, query.status));
  return getDb()
    .select({
      id: stations.id,
      locationId: stations.locationId,
      locationName: locations.name,
      name: stations.name,
      description: stations.description,
      imageUrl: stations.imageUrl,
      displayOrder: stations.displayOrder,
      status: stations.status,
    })
    .from(stations)
    .innerJoin(
      locations,
      and(
        eq(locations.id, stations.locationId),
        eq(locations.organizationId, stations.organizationId),
      ),
    )
    .where(and(...conditions))
    .orderBy(asc(locations.name), asc(stations.displayOrder), asc(stations.name));
}

export async function getStation(actor: ManagerSessionContext, stationId: string) {
  const [row] = await getDb()
    .select({
      id: stations.id,
      locationId: stations.locationId,
      locationName: locations.name,
      name: stations.name,
      description: stations.description,
      imageUrl: stations.imageUrl,
      displayOrder: stations.displayOrder,
      status: stations.status,
    })
    .from(stations)
    .innerJoin(
      locations,
      and(
        eq(locations.id, stations.locationId),
        eq(locations.organizationId, stations.organizationId),
      ),
    )
    .where(and(eq(stations.id, stationId), eq(stations.organizationId, actor.organizationId)))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Station not found.");
  await requireManagerManagedLocation(actor, row.locationId);
  return row;
}

export async function createStation(
  actor: ManagerSessionContext,
  input: StationCreateInput,
  requestId?: string,
) {
  await requireActiveManagedLocation(actor, input.locationId, requestId);
  const [row] = await mapConflicts(
    () =>
      getDb()
        .insert(stations)
        .values({ id: randomUUID(), organizationId: actor.organizationId, ...input })
        .returning(),
    "That station name or display order is already used at this location.",
  );
  if (!row) throw new AppError("INTERNAL_ERROR", "Station could not be created.");
  await auditMutation(actor, "station.created", "station", row.id, row.locationId, requestId);
  return row;
}

export async function updateStation(
  actor: ManagerSessionContext,
  stationId: string,
  input: StationUpdateInput,
  requestId?: string,
) {
  const current = await getStation(actor, stationId);
  if (current.locationId !== input.locationId) {
    await requireActiveManagedLocation(actor, input.locationId, requestId);
  }
  const [row] = await mapConflicts(
    () =>
      getDb()
        .update(stations)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(stations.id, stationId), eq(stations.organizationId, actor.organizationId)))
        .returning(),
    "That station name or display order is already used at this location.",
  );
  if (!row) throw new AppError("NOT_FOUND", "Station not found.");
  await auditMutation(
    actor,
    row.status === "disabled" ? "station.archived" : "station.updated",
    "station",
    row.id,
    current.locationId,
    requestId,
  );
  return row;
}

export async function listEmployees(actor: ManagerSessionContext, query: EmployeeQuery) {
  const managedIds = await getManagedLocationIds(actor);
  if (managedIds.length === 0) return [];
  const conditions: SQL[] = [
    eq(employees.organizationId, actor.organizationId),
    inArray(employees.primaryLocationId, managedIds),
  ];
  if (query.locationId) {
    if (!managedIds.includes(query.locationId)) return [];
    conditions.push(eq(employees.primaryLocationId, query.locationId));
  }
  if (query.status) conditions.push(eq(employees.status, query.status));
  if (query.search) {
    const pattern = `%${query.search}%`;
    conditions.push(
      or(
        ilike(employees.displayName, pattern),
        ilike(employees.employeeNumber, pattern),
        ilike(employees.jobRole, pattern),
      )!,
    );
  }
  return getDb()
    .select({
      id: employees.id,
      primaryLocationId: employees.primaryLocationId,
      locationName: locations.name,
      employeeNumber: employees.employeeNumber,
      displayName: employees.displayName,
      jobRole: employees.jobRole,
      language: employees.language,
      status: employees.status,
      phone: employees.phone,
      smsOptIn: employees.smsOptIn,
    })
    .from(employees)
    .innerJoin(
      locations,
      and(
        eq(locations.id, employees.primaryLocationId),
        eq(locations.organizationId, employees.organizationId),
      ),
    )
    .where(and(...conditions))
    .orderBy(asc(employees.displayName));
}

export async function getEmployee(actor: ManagerSessionContext, employeeId: string) {
  const [row] = await getDb()
    .select({
      id: employees.id,
      primaryLocationId: employees.primaryLocationId,
      locationName: locations.name,
      employeeNumber: employees.employeeNumber,
      displayName: employees.displayName,
      jobRole: employees.jobRole,
      language: employees.language,
      status: employees.status,
      phone: employees.phone,
      smsOptIn: employees.smsOptIn,
    })
    .from(employees)
    .innerJoin(
      locations,
      and(
        eq(locations.id, employees.primaryLocationId),
        eq(locations.organizationId, employees.organizationId),
      ),
    )
    .where(and(eq(employees.id, employeeId), eq(employees.organizationId, actor.organizationId)))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Employee not found.");
  await requireManagerManagedLocation(actor, row.primaryLocationId);
  return row;
}

export async function createEmployee(
  actor: ManagerSessionContext,
  input: EmployeeCreateInput,
  requestId?: string,
) {
  await requireActiveManagedLocation(actor, input.primaryLocationId, requestId);
  const pinHash = await hashSecret(input.pin);
  const { pin: _pin, ...profile } = input;
  void _pin;
  const [row] = await mapConflicts(
    () =>
      getDb()
        .insert(employees)
        .values({ id: randomUUID(), organizationId: actor.organizationId, pinHash, ...profile })
        .returning({ id: employees.id, primaryLocationId: employees.primaryLocationId }),
    "That employee number is already in use.",
  );
  if (!row) throw new AppError("INTERNAL_ERROR", "Employee could not be created.");
  await auditMutation(
    actor,
    "employee.created",
    "employee",
    row.id,
    row.primaryLocationId,
    requestId,
  );
  return getEmployee(actor, row.id);
}

export async function updateEmployee(
  actor: ManagerSessionContext,
  employeeId: string,
  input: EmployeeUpdateInput,
  requestId?: string,
) {
  const current = await getEmployee(actor, employeeId);
  if (current.primaryLocationId !== input.primaryLocationId) {
    await requireActiveManagedLocation(actor, input.primaryLocationId, requestId);
  }
  const [row] = await mapConflicts(
    () =>
      getDb()
        .update(employees)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(eq(employees.id, employeeId), eq(employees.organizationId, actor.organizationId)),
        )
        .returning({ id: employees.id }),
    "That employee number is already in use.",
  );
  if (!row) throw new AppError("NOT_FOUND", "Employee not found.");
  if (input.status === "disabled" || current.primaryLocationId !== input.primaryLocationId) {
    await revokeEmployeeSessions(row.id);
  }
  await auditMutation(
    actor,
    input.status === "disabled" ? "account.disabled" : "employee.updated",
    "employee",
    row.id,
    current.primaryLocationId,
    requestId,
  );
  return getEmployee(actor, row.id);
}

export async function listManagers(actor: ManagerSessionContext) {
  await requireOwner(actor);
  return getDb()
    .select({
      membershipId: managerMemberships.id,
      displayName: managerUsers.displayName,
      email: managerUsers.email,
      role: managerMemberships.role,
      status: managerMemberships.status,
    })
    .from(managerMemberships)
    .innerJoin(managerUsers, eq(managerUsers.id, managerMemberships.managerUserId))
    .where(eq(managerMemberships.organizationId, actor.organizationId))
    .orderBy(asc(managerUsers.displayName));
}

export async function getManagerAssignments(actor: ManagerSessionContext, membershipId: string) {
  await requireOwner(actor);
  const [manager] = await getDb()
    .select({
      membershipId: managerMemberships.id,
      displayName: managerUsers.displayName,
      email: managerUsers.email,
      role: managerMemberships.role,
      status: managerMemberships.status,
    })
    .from(managerMemberships)
    .innerJoin(managerUsers, eq(managerUsers.id, managerMemberships.managerUserId))
    .where(
      and(
        eq(managerMemberships.id, membershipId),
        eq(managerMemberships.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  if (!manager) throw new AppError("NOT_FOUND", "Manager not found.");
  const grants = await getDb()
    .select({ locationId: managerLocationAccess.locationId })
    .from(managerLocationAccess)
    .where(
      and(
        eq(managerLocationAccess.organizationId, actor.organizationId),
        eq(managerLocationAccess.membershipId, membershipId),
      ),
    );
  return { ...manager, locationIds: grants.map((grant) => grant.locationId) };
}

export async function setManagerLocationAssignments(
  actor: ManagerSessionContext,
  membershipId: string,
  locationIds: string[],
  requestId?: string,
) {
  await requireOwner(actor, requestId);
  const manager = await getManagerAssignments(actor, membershipId);
  const uniqueIds = [...new Set(locationIds)];
  if (uniqueIds.length > 0) {
    const validLocations = await getDb()
      .select({ id: locations.id })
      .from(locations)
      .where(
        and(eq(locations.organizationId, actor.organizationId), inArray(locations.id, uniqueIds)),
      );
    if (validLocations.length !== uniqueIds.length) {
      throw new AppError("FORBIDDEN", "One or more locations are outside this organization.");
    }
  }
  await getDb().transaction(async (tx) => {
    await tx
      .delete(managerLocationAccess)
      .where(
        and(
          eq(managerLocationAccess.organizationId, actor.organizationId),
          eq(managerLocationAccess.membershipId, membershipId),
        ),
      );
    if (manager.role === "manager" && uniqueIds.length > 0) {
      await tx.insert(managerLocationAccess).values(
        uniqueIds.map((locationId) => ({
          organizationId: actor.organizationId,
          membershipId,
          locationId,
        })),
      );
    }
  });
  await auditMutation(
    actor,
    "manager.locations_updated",
    "manager_membership",
    membershipId,
    undefined,
    requestId,
  );
  return getManagerAssignments(actor, membershipId);
}

export async function listStationsForEmployee(session: EmployeeSessionContext) {
  return getDb()
    .select({
      id: stations.id,
      name: stations.name,
      description: stations.description,
      imageUrl: stations.imageUrl,
      displayOrder: stations.displayOrder,
    })
    .from(stations)
    .where(
      and(
        eq(stations.organizationId, session.organizationId),
        eq(stations.locationId, session.locationId),
        eq(stations.status, "active"),
      ),
    )
    .orderBy(asc(stations.displayOrder), asc(stations.name));
}

export async function getStationForEmployee(session: EmployeeSessionContext, stationId: string) {
  const [row] = await getDb()
    .select({
      id: stations.id,
      name: stations.name,
      description: stations.description,
      imageUrl: stations.imageUrl,
    })
    .from(stations)
    .where(
      and(
        eq(stations.id, stationId),
        eq(stations.organizationId, session.organizationId),
        eq(stations.locationId, session.locationId),
        eq(stations.status, "active"),
      ),
    )
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "That station is not available.");
  return row;
}
