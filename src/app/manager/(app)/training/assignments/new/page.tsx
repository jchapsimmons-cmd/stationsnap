import { AssignmentForm } from "@/components/training/assignment-form";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listEmployees } from "@/server/management/service";
import { listTrainableSops } from "@/server/training/service";

export default async function NewTrainingAssignmentPage() {
  const session = await requireManagerPage("/manager/training/assignments/new");
  const [sops, employees] = await Promise.all([
    listTrainableSops(session),
    listEmployees(session, { search: "", locationId: "", status: "active" }),
  ]);

  return (
    <div className="page-stack">
      <PageHeader
        title="New training assignment"
        description="Assign a published, training-enabled SOP to employees, a job role, or a whole location."
      />
      {sops.length === 0 ? (
        <EmptyState
          title="No training-enabled SOPs"
          description="Publish an SOP with training enabled before assigning it."
        />
      ) : (
        <AssignmentForm
          sops={sops}
          employees={employees.map((employee) => ({
            id: employee.id,
            displayName: employee.displayName,
            employeeNumber: employee.employeeNumber,
            jobRole: employee.jobRole,
            primaryLocationId: employee.primaryLocationId,
          }))}
        />
      )}
    </div>
  );
}
