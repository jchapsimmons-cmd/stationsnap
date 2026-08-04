import Link from "next/link";
import { StartOrResumeAction } from "@/components/training/start-or-resume-action";
import { ASSIGNMENT_STATUS_TONE, TRAINING_MODE_LABELS } from "@/components/training/status";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireEmployeePage } from "@/server/auth/authorization";
import { getAssignmentDetail } from "@/server/training/service";

export default async function EmployeeTrainingAssignmentPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const session = await requireEmployeePage(`/employee/training/${assignmentId}`);
  const assignment = await getAssignmentDetail(session, assignmentId);

  const canContinue = assignment.status !== "completed" && assignment.status !== "cancelled";
  const hasActiveSession = Boolean(assignment.activeSessionId);
  const attemptsExhausted =
    !hasActiveSession &&
    assignment.attemptsUsed >= assignment.maxAttempts &&
    assignment.status !== "completed";

  return (
    <div className="page-stack">
      <PageHeader
        title={assignment.sopTitle}
        description={`${TRAINING_MODE_LABELS[assignment.requiredMode]} training`}
      />
      <Card>
        <div className="action-row">
          <StatusBadge tone={ASSIGNMENT_STATUS_TONE[assignment.status] ?? "neutral"}>
            {assignment.status.replace("_", " ")}
          </StatusBadge>
          <StatusBadge tone="neutral">
            Attempt{" "}
            {Math.min(assignment.attemptsUsed + (hasActiveSession ? 0 : 1), assignment.maxAttempts)}{" "}
            of {assignment.maxAttempts}
          </StatusBadge>
        </div>
        {assignment.latestSession?.scorePercent != null && (
          <p>Last attempt scored {assignment.latestSession.scorePercent}%.</p>
        )}
      </Card>

      {assignment.sopHasNewerVersion && (
        <Card>
          <p role="status">
            This procedure has been updated since this training began.{" "}
            <Link href={`/employee/training/${assignmentId}/changes`}>See what changed</Link>.
          </p>
        </Card>
      )}

      {assignment.activeSessionId && (
        <Link
          href={`/employee/training/${assignmentId}/session/${assignment.activeSessionId}`}
          className="button button--secondary"
        >
          Continue where you left off
        </Link>
      )}

      {!hasActiveSession && canContinue && !attemptsExhausted && (
        <StartOrResumeAction
          assignmentId={assignmentId}
          label={assignment.attemptsUsed > 0 ? "Start next attempt" : "Start training"}
        />
      )}

      {attemptsExhausted && (
        <Card>
          <p role="alert">
            The maximum number of attempts has been reached. Ask your manager about retraining.
          </p>
        </Card>
      )}

      {assignment.status === "completed" && <Card>This training is complete.</Card>}
    </div>
  );
}
