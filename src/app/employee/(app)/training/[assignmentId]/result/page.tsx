import Link from "next/link";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireEmployeePage } from "@/server/auth/authorization";
import { getOpenCorrectionSubmissionId } from "@/server/training/approvals";
import { getAssignmentDetail } from "@/server/training/service";

const STATUS_MESSAGES: Record<string, string> = {
  passed: "Passed",
  failed: "Not yet passed",
  awaiting_approval: "Waiting on manager review",
};

export default async function EmployeeTrainingResultPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const session = await requireEmployeePage(`/employee/training/${assignmentId}/result`);
  const assignment = await getAssignmentDetail(session, assignmentId);
  const latest = assignment.latestSession;
  // A manager can send an awaiting-approval attempt back for a fix; the employee picks that up
  // through their own open correction request, never through a client-supplied submission id.
  const correctionSubmissionId = await getOpenCorrectionSubmissionId(session, assignmentId);

  return (
    <div className="page-stack">
      <PageHeader title="Training result" description={assignment.sopTitle} />
      <Card>
        {latest ? (
          <>
            <div className="action-row">
              <StatusBadge
                tone={
                  latest.status === "passed"
                    ? "success"
                    : latest.status === "awaiting_approval"
                      ? "warning"
                      : latest.status === "failed"
                        ? "danger"
                        : "neutral"
                }
              >
                {STATUS_MESSAGES[latest.status] ?? latest.status}
              </StatusBadge>
              {latest.scorePercent != null && (
                <StatusBadge tone="neutral">{latest.scorePercent}%</StatusBadge>
              )}
            </div>
            <p>
              Attempt {latest.attemptNumber} of {assignment.maxAttempts}.
            </p>
            {latest.status === "awaiting_approval" &&
              (correctionSubmissionId ? (
                <>
                  <p>Your manager asked for one fix before this attempt can be approved.</p>
                  <Link
                    href={`/employee/approvals/${correctionSubmissionId}`}
                    className="button button--primary"
                  >
                    See what to fix
                  </Link>
                </>
              ) : (
                <p>A manager will review your submitted evidence before this attempt is final.</p>
              ))}
            {latest.status === "failed" && assignment.attemptsUsed < assignment.maxAttempts && (
              <Link
                href={`/employee/training/${assignmentId}`}
                className="button button--secondary"
              >
                Try again
              </Link>
            )}
          </>
        ) : (
          <p>No attempts have been submitted yet.</p>
        )}
      </Card>
    </div>
  );
}
