import { PinResetForm } from "@/components/management/forms";
import { PageHeader } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getEmployee } from "@/server/management/service";
export default async function EmployeePinPage({
  params,
}: {
  params: Promise<{ employeeId: string }>;
}) {
  const { employeeId } = await params;
  const session = await requireManagerPage(`/manager/employees/${employeeId}/pin`);
  const employee = await getEmployee(session, employeeId);
  return (
    <div className="page-stack">
      <PageHeader
        title={`Reset PIN for ${employee.displayName}`}
        description="Resetting the PIN immediately revokes existing employee sessions."
      />
      <PinResetForm employeeId={employee.id} />
    </div>
  );
}
