import type { DomainEventType } from "@/server/events";

export const ACTIVITY_TYPE_LABELS: Record<DomainEventType, string> = {
  "sop.published": "SOP published",
  "sop.archived": "SOP archived",
  "training.assignment_batch_created": "Training assigned",
  "training.session_completed": "Training attempt completed",
  "training.approval_decided": "Training approval decided",
  "qualification.awarded": "Qualification awarded",
  "qualification.revoked": "Qualification revoked",
  "checklist.created": "Checklist created",
  "checklist_run.submitted": "Checklist run submitted",
  "checklist_run.approval_decided": "Checklist approval decided",
  "translation.approved": "Translation approved",
};

const PAYLOAD_STRING_KEYS = ["status", "decision", "targetType", "requiredMode"] as const;

/** Turns an activity row's payload into a short human summary, e.g. "status: passed". */
export function summarizeActivityPayload(
  payload: Record<string, string | number | boolean | null>,
): string {
  const parts: string[] = [];
  for (const key of PAYLOAD_STRING_KEYS) {
    const value = payload[key];
    if (typeof value === "string" && value) parts.push(value.replace(/_/g, " "));
  }
  if (typeof payload["createdCount"] === "number") {
    parts.push(`${payload["createdCount"]} assigned`);
  }
  return parts.join(" · ");
}
