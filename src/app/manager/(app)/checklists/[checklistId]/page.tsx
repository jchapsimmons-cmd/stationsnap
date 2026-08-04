import Link from "next/link";
import {
  CHECKLIST_RECURRENCE_LABELS,
  CHECKLIST_STATUS_LABELS,
  CHECKLIST_STATUS_TONE,
  CHECKLIST_TYPE_LABELS,
} from "@/components/checklists/status";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getChecklistDetail } from "@/server/checklists/service";

export default async function ManagerChecklistDetailPage({
  params,
}: {
  params: Promise<{ checklistId: string }>;
}) {
  const { checklistId } = await params;
  const session = await requireManagerPage(`/manager/checklists/${checklistId}`);
  const checklist = await getChecklistDetail(session, checklistId);

  return (
    <div className="page-stack">
      <PageHeader
        title={checklist.title}
        description={`${CHECKLIST_TYPE_LABELS[checklist.type] ?? checklist.type} · ${CHECKLIST_RECURRENCE_LABELS[checklist.recurrenceType] ?? checklist.recurrenceType}`}
        actions={
          <Link className="button button--secondary" href={`/manager/checklists/${checklist.id}/edit`}>
            Edit checklist
          </Link>
        }
      />

      <Card>
        <div className="action-row">
          <StatusBadge tone={CHECKLIST_STATUS_TONE[checklist.status] ?? "neutral"}>
            {CHECKLIST_STATUS_LABELS[checklist.status] ?? checklist.status}
          </StatusBadge>
        </div>
        {checklist.description && <p>{checklist.description}</p>}
      </Card>

      <Card className="form-section">
        <h2>Items</h2>
        {checklist.items.length === 0 ? (
          <p className="muted">This checklist has no items.</p>
        ) : (
          <ol className="step-list">
            {checklist.items.map((item, index) => (
              <li key={item.id}>
                <Card className="step-card">
                  <div className="step-card__head">
                    <span className="step-order-badge" aria-hidden="true">
                      {index + 1}
                    </span>
                    <div className="step-card__title">
                      <strong>{item.title}</strong>
                      {item.instructions && <small>{item.instructions}</small>}
                    </div>
                    <StatusBadge tone={item.isRequired ? "info" : "neutral"}>
                      {item.isRequired ? "Required" : "Optional"}
                    </StatusBadge>
                  </div>
                  <div className="action-row">
                    {item.timerSeconds != null && (
                      <StatusBadge tone="neutral">Timer · {item.timerSeconds}s</StatusBadge>
                    )}
                    {item.requirePhoto && <StatusBadge tone="neutral">Photo required</StatusBadge>}
                    {item.requireNote && <StatusBadge tone="neutral">Note required</StatusBadge>}
                    {item.requireApproval && (
                      <StatusBadge tone="neutral">Manager approval required</StatusBadge>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
