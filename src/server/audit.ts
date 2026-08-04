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
  | "session.logout"
  | "organization.updated"
  | "location.created"
  | "location.updated"
  | "location.disabled"
  | "station.created"
  | "station.updated"
  | "station.archived"
  | "employee.created"
  | "employee.updated"
  | "manager.locations_updated"
  | "sop.created"
  | "sop.updated"
  | "sop.step_deleted"
  | "sop.archived"
  | "sop.previewed"
  | "sop.published"
  | "sop.draft_created"
  | "sop.version_restored"
  | "sop.viewed"
  | "media.uploaded"
  | "qr.created"
  | "qr.revoked"
  | "qr.rotated"
  | "qr.scanned"
  | "training.assigned"
  | "training.session_started"
  | "training.session_resumed"
  | "training.step_progress_recorded"
  | "training.answer_submitted"
  | "training.evidence_submitted"
  | "training.session_submitted"
  | "training.approval_decided"
  | "training.correction_requested"
  | "training.correction_resubmitted"
  | "training_path.created"
  | "training_path.updated"
  | "qualification.awarded"
  | "qualification.revoked"
  | "checklist.created"
  | "checklist.updated"
  | "checklist_run.started"
  | "checklist_run.resumed"
  | "checklist_run.item_progress_recorded"
  | "checklist_run.evidence_submitted"
  | "checklist_run.submitted"
  | "checklist_run.approval_decided"
  | "checklist_run.correction_requested"
  | "checklist_run.correction_resubmitted";

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
