import { toCsv } from "@/lib/csv";

/**
 * Bounded row cap for every CSV export route: large enough for a real organization's report, but
 * a hard ceiling rather than "everything", consistent with `route-map.md`'s "every list accepts
 * bounded pagination" convention extended to exports.
 */
export const REPORT_EXPORT_MAX_ROWS = 5_000;
import type { ApprovalHistoryRow } from "@/server/reports";
import type { getSopVersionHistoryReport } from "@/server/sops/service";
import type { getChecklistCompletionReport } from "@/server/checklists/runs";
import type { getTrainingProgressReport } from "@/server/training/service";
import type { QualificationOverviewRow } from "@/server/training/qualifications";

function isoOrEmpty(value: Date | null | undefined): string {
  return value ? value.toISOString() : "";
}

type TrainingProgressRow = Awaited<ReturnType<typeof getTrainingProgressReport>>["items"][number];

/** Row mapper for `/manager/reports/training` CSV export — same fields the table displays. */
export function trainingProgressReportToCsv(items: readonly TrainingProgressRow[]): string {
  return toCsv(
    ["Employee", "SOP", "Version", "Location", "Status", "Due", "Updated"],
    items.map((row) => [
      row.employeeName,
      row.sopTitle,
      row.versionNumber,
      row.locationName,
      row.status,
      isoOrEmpty(row.dueAt),
      isoOrEmpty(row.updatedAt),
    ]),
  );
}

/** Row mapper for `/manager/reports/qualifications` CSV export. */
export function qualificationsReportToCsv(items: readonly QualificationOverviewRow[]): string {
  return toCsv(
    [
      "Employee",
      "Employee number",
      "Qualification",
      "Path",
      "Location",
      "Status",
      "Expiring soon",
      "Awarded",
      "Expires",
    ],
    items.map((row) => [
      row.employeeName,
      row.employeeNumber,
      row.definitionName,
      row.pathTitle,
      row.locationName,
      row.classification,
      row.isExpiringSoon ? "yes" : "no",
      isoOrEmpty(row.awardedAt),
      isoOrEmpty(row.expiresAt),
    ]),
  );
}

type ChecklistCompletionRow = Awaited<
  ReturnType<typeof getChecklistCompletionReport>
>["items"][number];

/** Row mapper for `/manager/reports/checklists` CSV export. */
export function checklistCompletionReportToCsv(items: readonly ChecklistCompletionRow[]): string {
  return toCsv(
    ["Checklist", "Type", "Employee", "Location", "Status", "Started", "Submitted", "Completed"],
    items.map((row) => [
      row.checklistTitle,
      row.checklistType,
      row.employeeName,
      row.locationName,
      row.status,
      isoOrEmpty(row.startedAt),
      isoOrEmpty(row.submittedAt),
      isoOrEmpty(row.completedAt),
    ]),
  );
}

/** Row mapper for `/manager/reports/approvals` CSV export. */
export function approvalHistoryReportToCsv(items: readonly ApprovalHistoryRow[]): string {
  return toCsv(
    ["Kind", "Decision", "Employee", "Subject", "Location", "Decided by", "Decided at", "Note"],
    items.map((row) => [
      row.kind,
      row.decision,
      row.employeeName,
      row.subjectTitle,
      row.locationName,
      row.decidedByName,
      isoOrEmpty(row.decidedAt),
      row.note,
    ]),
  );
}

type SopVersionHistoryRow = Awaited<ReturnType<typeof getSopVersionHistoryReport>>["items"][number];

/** Row mapper for `/manager/reports/sop-versions` CSV export. */
export function sopVersionHistoryReportToCsv(items: readonly SopVersionHistoryRow[]): string {
  return toCsv(
    ["SOP", "Version", "Status", "Category", "Location", "Change summary", "Published"],
    items.map((row) => [
      row.title,
      row.versionNumber,
      row.status,
      row.category,
      row.locationName,
      row.changeSummary,
      isoOrEmpty(row.publishedAt),
    ]),
  );
}
