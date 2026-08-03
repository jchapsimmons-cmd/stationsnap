import { and, count, eq } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { writeAuditEvent } from "@/server/audit";
import { requireManagerLocation, requireOwner } from "@/server/auth/authorization";
import { hashSecret } from "@/server/auth/crypto";
import { revokeEmployeeSessions } from "@/server/auth/service";
import type { ManagerSessionContext } from "@/server/auth/sessions";
import { getDb } from "@/server/db/client";
import { employees, managerMemberships, managerSessions } from "@/server/db/schema";

async function assertNotLastOwner(organizationId: string, membershipId: string): Promise<void> {
  const [membership] = await getDb()
    .select({ role: managerMemberships.role, status: managerMemberships.status })
    .from(managerMemberships)
    .where(
      and(
        eq(managerMemberships.id, membershipId),
        eq(managerMemberships.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!membership) throw new AppError("NOT_FOUND", "Manager membership not found.");
  if (membership.role !== "owner" || membership.status !== "active") return;
  const [owners] = await getDb()
    .select({ value: count() })
    .from(managerMemberships)
    .where(
      and(
        eq(managerMemberships.organizationId, organizationId),
        eq(managerMemberships.role, "owner"),
        eq(managerMemberships.status, "active"),
      ),
    );
  if (!owners || owners.value <= 1) {
    throw new AppError("CONFLICT", "The organization must keep at least one active owner.");
  }
}

export async function resetEmployeePin(
  actor: ManagerSessionContext,
  input: { employeeId: string; pin: string },
  requestId?: string,
): Promise<void> {
  const [employee] = await getDb()
    .select({ id: employees.id, locationId: employees.primaryLocationId })
    .from(employees)
    .where(
      and(eq(employees.id, input.employeeId), eq(employees.organizationId, actor.organizationId)),
    )
    .limit(1);
  if (!employee) throw new AppError("NOT_FOUND", "Employee not found.");
  await requireManagerLocation(actor, employee.locationId, requestId);
  const pinHash = await hashSecret(input.pin);
  await getDb()
    .update(employees)
    .set({ pinHash, updatedAt: new Date() })
    .where(eq(employees.id, employee.id));
  await revokeEmployeeSessions(employee.id);
  await writeAuditEvent({
    organizationId: actor.organizationId,
    locationId: employee.locationId,
    actorKind: "manager",
    actorId: actor.managerUserId,
    action: "employee.pin_reset",
    targetType: "employee",
    targetId: employee.id,
    requestId,
  });
}

export async function changeManagerRole(
  actor: ManagerSessionContext,
  input: { membershipId: string; role: "owner" | "manager" },
  requestId?: string,
): Promise<void> {
  await requireOwner(actor, requestId);
  if (input.role === "manager") await assertNotLastOwner(actor.organizationId, input.membershipId);
  const [membership] = await getDb()
    .update(managerMemberships)
    .set({ role: input.role, updatedAt: new Date() })
    .where(
      and(
        eq(managerMemberships.id, input.membershipId),
        eq(managerMemberships.organizationId, actor.organizationId),
      ),
    )
    .returning({ id: managerMemberships.id, managerUserId: managerMemberships.managerUserId });
  if (!membership) throw new AppError("NOT_FOUND", "Manager membership not found.");
  await getDb()
    .update(managerSessions)
    .set({ revokedAt: new Date() })
    .where(eq(managerSessions.membershipId, membership.id));
  await writeAuditEvent({
    organizationId: actor.organizationId,
    actorKind: "manager",
    actorId: actor.managerUserId,
    action: "manager.role_changed",
    targetType: "manager_membership",
    targetId: membership.id,
    metadata: { role: input.role },
    requestId,
  });
}

export async function disableManagerAccount(
  actor: ManagerSessionContext,
  membershipId: string,
  requestId?: string,
): Promise<void> {
  await requireOwner(actor, requestId);
  await assertNotLastOwner(actor.organizationId, membershipId);
  const [membership] = await getDb()
    .update(managerMemberships)
    .set({ status: "disabled", updatedAt: new Date() })
    .where(
      and(
        eq(managerMemberships.id, membershipId),
        eq(managerMemberships.organizationId, actor.organizationId),
      ),
    )
    .returning({ id: managerMemberships.id });
  if (!membership) throw new AppError("NOT_FOUND", "Manager not found.");
  await getDb()
    .update(managerSessions)
    .set({ revokedAt: new Date() })
    .where(eq(managerSessions.membershipId, membership.id));
  await writeAuditEvent({
    organizationId: actor.organizationId,
    actorKind: "manager",
    actorId: actor.managerUserId,
    action: "account.disabled",
    targetType: "manager_membership",
    targetId: membership.id,
    requestId,
  });
}

export async function disableEmployeeAccount(
  actor: ManagerSessionContext,
  employeeId: string,
  requestId?: string,
): Promise<void> {
  const [employee] = await getDb()
    .select({ id: employees.id, locationId: employees.primaryLocationId })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.organizationId, actor.organizationId)))
    .limit(1);
  if (!employee) throw new AppError("NOT_FOUND", "Employee not found.");
  await requireManagerLocation(actor, employee.locationId, requestId);
  await getDb()
    .update(employees)
    .set({ status: "disabled", updatedAt: new Date() })
    .where(eq(employees.id, employee.id));
  await revokeEmployeeSessions(employee.id);
  await writeAuditEvent({
    organizationId: actor.organizationId,
    locationId: employee.locationId,
    actorKind: "manager",
    actorId: actor.managerUserId,
    action: "account.disabled",
    targetType: "employee",
    targetId: employee.id,
    requestId,
  });
}
