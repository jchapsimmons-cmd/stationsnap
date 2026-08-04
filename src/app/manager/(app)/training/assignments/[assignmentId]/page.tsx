import Link from "next/link";
import {
  ASSIGNMENT_STATUS_LABELS,
  ASSIGNMENT_STATUS_TONE,
  TRAINING_MODE_LABELS,
} from "@/components/training/status";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getManagerAssignmentDetail } from "@/server/training/service";

function formatDueDate(dueAt: Date | null, dueTimezone: string | null): string | null {
  if (!dueAt) return null;
  return dueAt.toLocaleDateString("en-US", {
    timeZone: dueTimezone ?? "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function ManagerTrainingAssignmentDetailPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const session = await requireManagerPage(`/manager/training/assignments/${assignmentId}`);
  const assignment = await getManagerAssignmentDetail(session, assignmentId);
  const dueLabel = formatDueDate(assignment.dueAt, assignment.dueTimezone);

  return (
    <div className="page-stack">
      <PageHeader
        title={assignment.employeeName}
        description={`${assignment.sopTitle} · ${assignment.locationName}`}
        actions={
          <Link
            className="button button--secondary"
            href={`/manager/employees/${assignment.employeeId}`}
          >
            View employee
          </Link>
        }
      />
      <Card>
        <div className="action-row">
          <StatusBadge tone={ASSIGNMENT_STATUS_TONE[assignment.status] ?? "neutral"}>
            {ASSIGNMENT_STATUS_LABELS[assignment.status] ?? assignment.status}
          </StatusBadge>
          <StatusBadge tone="neutral">
            {TRAINING_MODE_LABELS[assignment.requiredMode] ?? assignment.requiredMode}
          </StatusBadge>
          {assignment.retrainingGeneration > 0 && (
            <StatusBadge tone="info">Retraining #{assignment.retrainingGeneration}</StatusBadge>
          )}
        </div>
      </Card>
      <div className="detail-grid">
        <Card>
          <p className="eyebrow">Employee number</p>
          <strong>#{assignment.employeeNumber}</strong>
        </Card>
        <Card>
          <p className="eyebrow">SOP</p>
          <Link href={`/manager/sops/${assignment.sopId}`}>{assignment.sopTitle}</Link>
        </Card>
        <Card>
          <p className="eyebrow">Due date</p>
          <strong>{dueLabel ?? "No due date"}</strong>
        </Card>
        <Card>
          <p className="eyebrow">Attempts used</p>
          <strong>{assignment.attemptsUsed}</strong>
        </Card>
      </div>

      {assignment.latestSession && (
        <Card>
          <h2>Latest attempt</h2>
          <div className="detail-grid">
            <div>
              <p className="eyebrow">Attempt number</p>
              <strong>{assignment.latestSession.attemptNumber}</strong>
            </div>
            <div>
              <p className="eyebrow">Status</p>
              <strong>{assignment.latestSession.status.replace("_", " ")}</strong>
            </div>
            <div>
              <p className="eyebrow">Score</p>
              <strong>
                {assignment.latestSession.scorePercent != null
                  ? `${assignment.latestSession.scorePercent}%`
                  : "Not yet scored"}
              </strong>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
