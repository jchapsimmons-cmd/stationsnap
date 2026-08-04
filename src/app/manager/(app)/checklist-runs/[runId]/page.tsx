import Link from "next/link";
import {
  CHECKLIST_RUN_STATUS_LABELS,
  CHECKLIST_RUN_STATUS_TONE,
  CHECKLIST_TYPE_LABELS,
} from "@/components/checklists/status";
import { ChecklistRunDecisionForm } from "@/components/checklists/run-decision-form";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getChecklistRunDetail } from "@/server/checklists/runs";

function formatInstant(value: Date): string {
  return value.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function ManagerChecklistRunReviewPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const session = await requireManagerPage(`/manager/checklist-runs/${runId}`);
  const detail = await getChecklistRunDetail(session, runId);

  return (
    <div className="page-stack">
      <PageHeader
        title={detail.employeeName}
        description={`${detail.checklistTitle} · ${CHECKLIST_TYPE_LABELS[detail.checklistType] ?? detail.checklistType} · ${detail.locationName}`}
        actions={
          <Link className="button button--secondary" href="/manager/checklist-runs">
            Back to runs
          </Link>
        }
      />

      <Card>
        <div className="action-row">
          <StatusBadge tone={CHECKLIST_RUN_STATUS_TONE[detail.status] ?? "neutral"}>
            {CHECKLIST_RUN_STATUS_LABELS[detail.status] ?? detail.status}
          </StatusBadge>
          <StatusBadge tone="neutral">#{detail.employeeNumber}</StatusBadge>
          <StatusBadge tone="neutral">Started {formatInstant(detail.startedAt)}</StatusBadge>
          {detail.submittedAt && (
            <StatusBadge tone="neutral">Submitted {formatInstant(detail.submittedAt)}</StatusBadge>
          )}
        </div>
      </Card>

      <Card className="form-section">
        <h2>Items</h2>
        {detail.items.length === 0 ? (
          <EmptyState title="No items" description="This checklist run has no items." />
        ) : (
          <ol className="step-list">
            {detail.items.map((item) => (
              <li key={item.id}>
                <Card className="step-card">
                  <div className="step-card__head">
                    <span className="step-order-badge" aria-hidden="true">
                      {item.displayOrder}
                    </span>
                    <div className="step-card__title">
                      <strong>{item.title}</strong>
                      {item.instructions && <small>{item.instructions}</small>}
                    </div>
                    <StatusBadge tone={item.isDone ? "success" : "warning"}>
                      {item.isDone ? "Done" : "Incomplete"}
                    </StatusBadge>
                  </div>
                  {item.employeeNote && <p>{item.employeeNote}</p>}
                  {item.evidence.length > 0 && (
                    <ul className="mobile-list" aria-label={`Evidence for ${item.title}`}>
                      {item.evidence.map((row) => (
                        <li key={row.id}>
                          <div className="preview-shell">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/management/media/${row.fileId}`}
                              alt={`Evidence generation ${row.submissionGeneration} for ${item.title}`}
                            />
                          </div>
                          {row.employeeNote && <p>{row.employeeNote}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {detail.submission?.isDecidable ? (
        <ChecklistRunDecisionForm runId={detail.id} />
      ) : detail.submission ? (
        <Card>
          <p role="status">
            This submission was already decided. Decisions are permanent — a new submission appears
            here if the employee resubmits after a requested correction.
          </p>
        </Card>
      ) : null}

      {detail.submissions.length > 0 && (
        <Card className="form-section">
          <h2>Submission generations</h2>
          <ul className="mobile-list" aria-label="Submission generations">
            {detail.submissions.map((row) => (
              <li key={row.id}>
                <div>
                  <strong>Generation {row.submissionGeneration}</strong>
                  <span>{formatInstant(row.submittedAt)}</span>
                </div>
                <StatusBadge tone="neutral">{row.status}</StatusBadge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
