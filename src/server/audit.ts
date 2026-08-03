import { randomUUID } from "node:crypto";
import { getDb } from "@/server/db/client";
import { auditEvents } from "@/server/db/schema";

export type AuditAction =
  | "manager.login"
  | "employee.login"
  | "login.failed"
  | "login.locked"
  | "manager.role_changed"
  | "employee.pin_reset"
  | "account.disabled"
  | "access.unauthorized"
  | "manager.password_reset_requested"
  | "manager.password_reset_completed"
  | "session.logout";

export interface AuditEventInput {
  organizationId?: string;
  locationId?: string;
  actorKind: "manager" | "employee" | "system" | "anonymous";
  actorId?: string;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, string | number | boolean | null>;
  requestId?: string;
}

export async function writeAuditEvent(input: AuditEventInput): Promise<void> {
  if (input.locationId && !input.organizationId) {
    throw new Error("Audit events with a location must include its organization");
  }
  const metadata = Object.fromEntries(
    Object.entries(input.metadata ?? {}).filter(
      ([key]) => !/(password|pin|token|secret|authorization|cookie)/i.test(key),
    ),
  );
  await getDb().insert(auditEvents).values({
    id: randomUUID(),
    organizationId: input.organizationId,
    locationId: input.locationId,
    actorKind: input.actorKind,
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata,
    requestId: input.requestId,
  });
}
