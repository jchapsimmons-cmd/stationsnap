import Link from "next/link";
import {
  CHECKLIST_RECURRENCE_LABELS,
  CHECKLIST_RUN_STATUS_LABELS,
  CHECKLIST_RUN_STATUS_TONE,
  CHECKLIST_TYPE_LABELS,
} from "@/components/checklists/status";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireEmployeePage } from "@/server/auth/authorization";
import { listChecklistsForEmployeeWithActiveRun } from "@/server/checklists/runs";
import { listChecklistsForEmployee } from "@/server/checklists/service";

export default async function EmployeeChecklistsPage() {
  const session = await requireEmployeePage("/employee/checklists");
  const [checklists, activeRuns] = await Promise.all([
    listChecklistsForEmployee(session),
    listChecklistsForEmployeeWithActiveRun(session),
  ]);

  return (
    <div className="page-stack">
      <PageHeader title="Checklists" description="Available checklists at your location." />
      {checklists.length === 0 ? (
        <EmptyState
          title="No checklists available"
          description="Your manager has not set up any checklists here yet."
        />
      ) : (
        <div className="record-grid">
          {checklists.map((checklist) => {
            const activeRun = activeRuns.get(checklist.id);
            return (
              <Link
                className="record-card"
                href={
                  activeRun
                    ? `/employee/checklist-runs/${activeRun.runId}`
                    : `/employee/checklists/${checklist.id}/start`
                }
                key={checklist.id}
              >
                <span className="record-card__body">
                  <strong>{checklist.title}</strong>
                  <small>
                    {CHECKLIST_TYPE_LABELS[checklist.type] ?? checklist.type} ·{" "}
                    {CHECKLIST_RECURRENCE_LABELS[checklist.recurrenceType] ??
                      checklist.recurrenceType}
                    {checklist.stationName ? ` · ${checklist.stationName}` : ""}
                  </small>
                </span>
                {activeRun && (
                  <StatusBadge tone={CHECKLIST_RUN_STATUS_TONE[activeRun.status] ?? "neutral"}>
                    {CHECKLIST_RUN_STATUS_LABELS[activeRun.status] ?? activeRun.status}
                  </StatusBadge>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
