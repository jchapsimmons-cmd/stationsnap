import Link from "next/link";
import { CorrectionResubmitForm } from "@/components/training/correction-resubmit-form";
import { APPROVAL_DECISION_LABELS } from "@/components/training/status";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireEmployeePage } from "@/server/auth/authorization";
import { getEmployeeCorrectionDetail } from "@/server/training/approvals";

function formatInstant(value: Date): string {
  return value.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function EmployeeCorrectionPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const { submissionId } = await params;
  const session = await requireEmployeePage(`/employee/approvals/${submissionId}`);
  const detail = await getEmployeeCorrectionDetail(session, submissionId);

  return (
    <div className="page-stack">
      <PageHeader
        title={detail.correction.isOpen ? "Correction requested" : "Correction sent"}
        description={detail.sopTitle}
      />

      <Card className="form-section">
        <div className="action-row">
          <StatusBadge tone={detail.correction.isOpen ? "warning" : "info"}>
            {detail.correction.isOpen ? "Needs your fix" : "Waiting on manager review"}
          </StatusBadge>
          <StatusBadge tone="neutral">Attempt {detail.session.attemptNumber}</StatusBadge>
        </div>
        <p className="eyebrow">Note from {detail.correction.managerName}</p>
        <p>{detail.correction.managerNote}</p>
        <p className="muted">Requested {formatInstant(detail.correction.requestedAt)}</p>
      </Card>

      {detail.correction.isOpen ? (
        <CorrectionResubmitForm
          submissionId={detail.submission.id}
          expectedRevision={detail.session.revision}
          steps={detail.steps.map((step) => ({
            id: step.id,
            displayOrder: step.displayOrder,
            title: step.title,
            acceptsPhoto: step.acceptsPhoto,
            acceptsVideo: step.acceptsVideo,
            evidenceCount: step.evidence.length,
          }))}
        />
      ) : (
        <Card>
          <p role="status">
            {detail.correction.resolvedAt
              ? `Your replacement proof was sent for review on ${formatInstant(detail.correction.resolvedAt)}.`
              : "Your replacement proof was sent for review."}{" "}
            A manager will look at it next.
          </p>
          <Link
            className="button button--secondary"
            href={`/employee/training/${detail.session.assignmentId}/result`}
          >
            Back to my result
          </Link>
        </Card>
      )}

      <Card className="form-section">
        <h2>What you sent</h2>
        <p className="muted">
          Everything you have submitted for this attempt is kept. Sending a fix adds to this list,
          it never replaces what came before.
        </p>
        <ul className="step-list">
          {detail.steps.map((step) => (
            <li key={step.id}>
              <Card className="step-card">
                <div className="step-card__head">
                  <span className="step-order-badge">{step.displayOrder}</span>
                  <span className="step-card__title">
                    <strong>{step.title ?? `Step ${step.displayOrder}`}</strong>
                    <small className="muted">{step.instruction}</small>
                  </span>
                </div>
                {step.evidence.length === 0 ? (
                  <p className="muted">Nothing submitted for this step yet.</p>
                ) : (
                  step.evidence.map((row) => (
                    <div className="preview-shell" key={row.id}>
                      {row.evidenceType === "photo" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/employee/media/${row.fileId}`}
                          alt={`Your submission ${row.submissionGeneration} for step ${step.displayOrder}`}
                        />
                      ) : (
                        <video src={`/api/employee/media/${row.fileId}`} controls />
                      )}
                      <p className="muted">
                        Submission {row.submissionGeneration} · {formatInstant(row.createdAt)}
                      </p>
                      {row.employeeNote && <p>{row.employeeNote}</p>}
                    </div>
                  ))
                )}
              </Card>
            </li>
          ))}
        </ul>
      </Card>

      {detail.decisions.length > 0 && (
        <Card className="form-section">
          <h2>Review history</h2>
          <ul className="mobile-list" aria-label="Review history">
            {detail.decisions.map((row, index) => (
              <li key={`${row.decidedAt.toISOString()}-${index}`}>
                <div>
                  <strong>{APPROVAL_DECISION_LABELS[row.decision] ?? row.decision}</strong>
                  <span>
                    {row.decidedByName} · {formatInstant(row.decidedAt)}
                  </span>
                  {row.note && <span>{row.note}</span>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
