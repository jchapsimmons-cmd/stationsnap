import { ChecklistRunRunner } from "@/components/checklists/run-runner";
import { PageHeader } from "@/components/ui";
import { requireEmployeePage } from "@/server/auth/authorization";
import { getChecklistRunState } from "@/server/checklists/runs";

export default async function EmployeeChecklistRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const session = await requireEmployeePage(`/employee/checklist-runs/${runId}`);
  const state = await getChecklistRunState(session, runId);

  return (
    <div className="page-stack">
      <PageHeader
        title={state.checklistTitle}
        description="Complete every required item, then submit."
      />
      <ChecklistRunRunner runId={runId} initialState={state} />
    </div>
  );
}
