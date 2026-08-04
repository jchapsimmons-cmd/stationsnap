import { TrainingSessionRunner } from "@/components/training/session-runner";
import { PageHeader } from "@/components/ui";
import { requireEmployeePage } from "@/server/auth/authorization";
import { getAssignmentDetail, getSessionState } from "@/server/training/service";

export default async function EmployeeTrainingSessionPage({
  params,
}: {
  params: Promise<{ assignmentId: string; sessionId: string }>;
}) {
  const { assignmentId, sessionId } = await params;
  const session = await requireEmployeePage(
    `/employee/training/${assignmentId}/session/${sessionId}`,
  );
  const [assignment, state] = await Promise.all([
    getAssignmentDetail(session, assignmentId),
    getSessionState(session, assignmentId, sessionId),
  ]);

  return (
    <div className="page-stack">
      <PageHeader title={assignment.sopTitle} description={`Attempt ${state.attemptNumber}`} />
      <TrainingSessionRunner
        assignmentId={assignmentId}
        sessionId={sessionId}
        initialState={state}
      />
    </div>
  );
}
