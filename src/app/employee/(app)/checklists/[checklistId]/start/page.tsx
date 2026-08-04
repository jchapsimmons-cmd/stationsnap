import { StartChecklistAction } from "@/components/checklists/start-checklist-action";
import { CHECKLIST_TYPE_LABELS } from "@/components/checklists/status";
import { Card, PageHeader } from "@/components/ui";
import { requireEmployeePage } from "@/server/auth/authorization";
import { getChecklistForEmployee } from "@/server/checklists/service";

export default async function EmployeeStartChecklistPage({
  params,
}: {
  params: Promise<{ checklistId: string }>;
}) {
  const { checklistId } = await params;
  const session = await requireEmployeePage(`/employee/checklists/${checklistId}/start`);
  const { checklist, items } = await getChecklistForEmployee(session, checklistId);

  return (
    <div className="page-stack">
      <PageHeader
        title={checklist.title}
        description={CHECKLIST_TYPE_LABELS[checklist.type] ?? checklist.type}
      />
      <Card>
        {checklist.description && <p>{checklist.description}</p>}
        <p>
          {items.length} {items.length === 1 ? "item" : "items"} to complete.
        </p>
      </Card>
      <StartChecklistAction checklistId={checklist.id} />
    </div>
  );
}
