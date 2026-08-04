import {
  CHECKLIST_RUN_STATUS_LABELS,
  CHECKLIST_RUN_STATUS_TONE,
  CHECKLIST_TYPE_LABELS,
} from "@/components/checklists/status";
import { PrintActions } from "@/components/print/print-actions";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getChecklistRunDetail } from "@/server/checklists/runs";

function formatInstant(value: Date | null): string {
  if (!value) return "—";
  return value.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function ChecklistRunPrintPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const session = await requireManagerPage(`/manager/print/checklists/${runId}`);
  const detail = await getChecklistRunDetail(session, runId);

  return (
    <div className="page-stack print-sheet">
      <PageHeader
        title={detail.checklistTitle}
        description={`${detail.employeeName} (#${detail.employeeNumber}) · ${
          CHECKLIST_TYPE_LABELS[detail.checklistType] ?? detail.checklistType
        } · ${detail.locationName}`}
        actions={<PrintActions pdfHref={`/manager/print/checklists/${runId}/pdf`} />}
      />
      <Card className="print-sheet__section">
        <StatusBadge tone={CHECKLIST_RUN_STATUS_TONE[detail.status] ?? "neutral"}>
          {CHECKLIST_RUN_STATUS_LABELS[detail.status] ?? detail.status}
        </StatusBadge>
        <p className="muted">Started {formatInstant(detail.startedAt)}</p>
        {detail.submittedAt && (
          <p className="muted">Submitted {formatInstant(detail.submittedAt)}</p>
        )}
        {detail.completedAt && (
          <p className="muted">Completed {formatInstant(detail.completedAt)}</p>
        )}
      </Card>

      <Card className="print-sheet__section">
        <h2>Items</h2>
        <ol className="print-sheet__steps">
          {detail.items.map((item) => (
            <li key={item.id} className="print-sheet__step">
              <p className="print-sheet__step-title">
                {item.isDone ? "☑" : "☐"} {item.displayOrder}. {item.title}
                {!item.isRequired && <span className="muted"> (optional)</span>}
              </p>
              {item.instructions && <p>{item.instructions}</p>}
              {item.employeeNote && <p className="muted">Note: {item.employeeNote}</p>}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
