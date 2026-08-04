import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireEmployeePage } from "@/server/auth/authorization";
import { getAssignmentDetail } from "@/server/training/service";

export default async function EmployeeTrainingChangesPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const session = await requireEmployeePage(`/employee/training/${assignmentId}/changes`);
  const assignment = await getAssignmentDetail(session, assignmentId);

  return (
    <div className="page-stack">
      <PageHeader title="What changed" description={assignment.sopTitle} />
      <Card>
        {assignment.sopHasNewerVersion ? (
          <>
            <p>This procedure was updated after this training began.</p>
            {assignment.newerVersionChangeSummary ? (
              <p>{assignment.newerVersionChangeSummary}</p>
            ) : (
              <p>No change summary was recorded for the update.</p>
            )}
            <p>Your current attempt continues to reflect the version you started training on.</p>
          </>
        ) : (
          <p>This procedure has not changed since this training began.</p>
        )}
      </Card>
      <Link href={`/employee/training/${assignmentId}`} className="button button--secondary">
        Back to training
      </Link>
    </div>
  );
}
