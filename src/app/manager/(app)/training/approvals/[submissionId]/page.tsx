import Link from "next/link";
import { ApprovalDecisionForm } from "@/components/training/approval-decision-form";
import {
  APPROVAL_DECISION_LABELS,
  APPROVAL_STATUS_LABELS,
  APPROVAL_STATUS_TONE,
  TRAINING_MODE_LABELS,
} from "@/components/training/status";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getApprovalSubmissionDetail } from "@/server/training/approvals";

function formatInstant(value: Date): string {
  return value.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function ManagerApprovalReviewPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const { submissionId } = await params;
  const session = await requireManagerPage(`/manager/training/approvals/${submissionId}`);
  const detail = await getApprovalSubmissionDetail(session, submissionId);

  return (
    <div className="page-stack">
      <PageHeader
        title={detail.employeeName}
        description={`${detail.sopTitle} · v${detail.sopVersionNumber} · ${detail.locationName}`}
        actions={
          <Link className="button button--secondary" href="/manager/training/approvals">
            Back to queue
          </Link>
        }
      />

      <Card>
        <div className="action-row">
          <StatusBadge tone={APPROVAL_STATUS_TONE[detail.submission.status] ?? "neutral"}>
            {APPROVAL_STATUS_LABELS[detail.submission.status] ?? detail.submission.status}
          </StatusBadge>
          <StatusBadge tone="neutral">
            {TRAINING_MODE_LABELS[detail.session.mode] ?? detail.session.mode}
          </StatusBadge>
          <StatusBadge tone="neutral">
            Submission {detail.submission.submissionGeneration}
          </StatusBadge>
          <StatusBadge tone="neutral">Attempt {detail.session.attemptNumber}</StatusBadge>
        </div>
      </Card>

      <div className="detail-grid">
        <Card>
          <p className="eyebrow">Employee number</p>
          <strong>#{detail.employeeNumber}</strong>
        </Card>
        <Card>
          <p className="eyebrow">SOP</p>
          <Link href={`/manager/sops/${detail.sopId}`}>{detail.sopTitle}</Link>
        </Card>
        <Card>
          <p className="eyebrow">Submitted</p>
          <strong>{formatInstant(detail.submission.submittedAt)}</strong>
        </Card>
        <Card>
          <p className="eyebrow">Score</p>
          <strong>
            {detail.session.scorePercent != null
              ? `${detail.session.scorePercent}% (pass ${detail.passingScorePercent}%)`
              : "Not scored"}
          </strong>
        </Card>
        <Card>
          <p className="eyebrow">Questions correct</p>
          <strong>
            {detail.quiz.correctAnswers} of {detail.quiz.totalQuestions}
          </strong>
        </Card>
        <Card>
          <p className="eyebrow">Assignment</p>
          <Link href={`/manager/training/assignments/${detail.assignment.id}`}>
            View assignment
          </Link>
        </Card>
      </div>

      <Card className="form-section">
        <h2>Evidence</h2>
        <p className="muted">
          Every generation the employee ever submitted, oldest first. Replacement evidence is added,
          never substituted for the original.
        </p>
        {detail.evidence.length === 0 ? (
          <EmptyState
            title="No evidence submitted"
            description="This attempt reached approval without any uploaded photo or video proof."
          />
        ) : (
          <ul className="step-list">
            {detail.evidence.map((row) => (
              <li key={row.id}>
                <Card className="step-card">
                  <div className="step-card__head">
                    <span className="step-order-badge">{row.stepDisplayOrder ?? "—"}</span>
                    <span className="step-card__title">
                      <strong>{row.stepTitle ?? "Session evidence"}</strong>
                      <small className="muted">
                        Generation {row.submissionGeneration} · {formatInstant(row.createdAt)}
                      </small>
                    </span>
                    <StatusBadge tone="neutral">{row.evidenceType}</StatusBadge>
                  </div>
                  <div className="preview-shell">
                    {row.evidenceType === "photo" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/management/media/${row.fileId}`}
                        alt={`Evidence generation ${row.submissionGeneration} for ${row.stepTitle ?? "this session"}`}
                      />
                    ) : (
                      <video src={`/api/management/media/${row.fileId}`} controls />
                    )}
                  </div>
                  {row.employeeNote && <p>{row.employeeNote}</p>}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {detail.submission.isDecidable ? (
        <ApprovalDecisionForm submissionId={detail.submission.id} />
      ) : (
        <Card>
          <p role="status">
            This submission was already decided. Decisions are permanent — open the newest
            submission in the queue to review a resubmission.
          </p>
        </Card>
      )}

      <Card className="form-section">
        <h2>Decision history</h2>
        {detail.decisions.length === 0 ? (
          <p className="muted">No decision has been recorded for this attempt yet.</p>
        ) : (
          <ul className="mobile-list" aria-label="Decision history">
            {detail.decisions.map((row) => (
              <li key={row.id}>
                <div>
                  <strong>{APPROVAL_DECISION_LABELS[row.decision] ?? row.decision}</strong>
                  <span>
                    Submission {row.submissionGeneration} · {row.decidedByName} ·{" "}
                    {formatInstant(row.decidedAt)}
                  </span>
                  {row.note && <span>{row.note}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {detail.corrections.length > 0 && (
        <Card className="form-section">
          <h2>Correction rounds</h2>
          <ul className="mobile-list" aria-label="Correction rounds">
            {detail.corrections.map((row) => (
              <li key={row.id}>
                <div>
                  <strong>
                    Submission {row.submissionGeneration} → generation {row.replacementGeneration}
                  </strong>
                  <span>{row.managerNote}</span>
                  <span>
                    Requested {formatInstant(row.requestedAt)} ·{" "}
                    {row.resolvedAt
                      ? `resubmitted ${formatInstant(row.resolvedAt)}`
                      : "waiting on the employee"}
                  </span>
                </div>
                <StatusBadge tone={row.resolvedAt ? "success" : "warning"}>
                  {row.resolvedAt ? "Resolved" : "Open"}
                </StatusBadge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="form-section">
        <h2>Submission generations</h2>
        <ul className="mobile-list" aria-label="Submission generations">
          {detail.submissions.map((row) => (
            <li key={row.id}>
              <div>
                <strong>Generation {row.submissionGeneration}</strong>
                <span>{formatInstant(row.submittedAt)}</span>
              </div>
              {row.id === detail.submission.id ? (
                <StatusBadge tone={APPROVAL_STATUS_TONE[row.status] ?? "neutral"}>
                  {APPROVAL_STATUS_LABELS[row.status] ?? row.status}
                </StatusBadge>
              ) : (
                <Link href={`/manager/training/approvals/${row.id}`}>
                  {APPROVAL_STATUS_LABELS[row.status] ?? row.status}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
