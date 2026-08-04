import {
  APPROVAL_DECISION_LABELS,
  ASSIGNMENT_STATUS_LABELS,
  ASSIGNMENT_STATUS_TONE,
} from "@/components/training/status";
import { PrintActions } from "@/components/print/print-actions";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getTrainingSessionForPrint } from "@/server/training/service";

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

export default async function TrainingSessionPrintPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const session = await requireManagerPage(`/manager/print/training/${sessionId}`);
  const record = await getTrainingSessionForPrint(session, sessionId);

  return (
    <div className="page-stack print-sheet">
      <PageHeader
        title={`${record.sopTitle} · v${record.sopVersionNumber}`}
        description={`${record.employeeName} (#${record.employeeNumber}) · ${record.locationName}`}
        actions={<PrintActions pdfHref={`/manager/print/training/${sessionId}/pdf`} />}
      />
      <Card className="detail-grid print-sheet__section">
        <div>
          <p className="eyebrow">Assignment status</p>
          <StatusBadge tone={ASSIGNMENT_STATUS_TONE[record.assignmentStatus] ?? "neutral"}>
            {ASSIGNMENT_STATUS_LABELS[record.assignmentStatus] ?? record.assignmentStatus}
          </StatusBadge>
        </div>
        <div>
          <p className="eyebrow">Mode</p>
          <strong>
            {record.mode} · attempt {record.attemptNumber}
          </strong>
        </div>
        {record.scorePercent !== null && (
          <div>
            <p className="eyebrow">Score</p>
            <strong>
              {record.scorePercent}% (passing {record.passingScorePercent}%)
            </strong>
          </div>
        )}
        {record.quizTotalQuestions > 0 && (
          <div>
            <p className="eyebrow">Quiz</p>
            <strong>
              {record.quizCorrectAnswers} / {record.quizTotalQuestions} correct
            </strong>
          </div>
        )}
        <div>
          <p className="eyebrow">Started</p>
          <strong>{formatInstant(record.startedAt)}</strong>
        </div>
        {record.completedAt && (
          <div>
            <p className="eyebrow">Completed</p>
            <strong>{formatInstant(record.completedAt)}</strong>
          </div>
        )}
      </Card>

      {record.evidence.length > 0 && (
        <Card className="print-sheet__section">
          <h2>Evidence</h2>
          <ul>
            {record.evidence.map((item) => (
              <li
                key={`${item.stepTitle ?? "final"}-${item.evidenceType}-${item.createdAt.toISOString()}`}
              >
                {item.stepTitle ? `Step: ${item.stepTitle}` : "Final evidence"} ·{" "}
                {item.evidenceType} · {formatInstant(item.createdAt)}
                {item.employeeNote ? ` — ${item.employeeNote}` : ""}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {record.latestDecision && (
        <Card className="print-sheet__section">
          <h2>Approval decision</h2>
          <p>
            <strong>
              {APPROVAL_DECISION_LABELS[record.latestDecision.decision] ??
                record.latestDecision.decision}
            </strong>{" "}
            by {record.latestDecision.decidedByName} on{" "}
            {formatInstant(record.latestDecision.decidedAt)}
          </p>
          {record.latestDecision.note && <p className="muted">{record.latestDecision.note}</p>}
        </Card>
      )}
    </div>
  );
}
