import { EmployeeForm } from "@/components/management/forms";
import { PageHeader } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getEmployee, listLocations } from "@/server/management/service";
export default async function EditEmployeePage({
  params,
}: {
  params: Promise<{ employeeId: string }>;
}) {
  const { employeeId } = await params;
  const session = await requireManagerPage(`/manager/employees/${employeeId}/edit`);
  const [employee, locations] = await Promise.all([
    getEmployee(session, employeeId),
    listLocations(session),
  ]);
  return (
    <div className="page-stack">
      <PageHeader
        title={`Edit ${employee.displayName}`}
        description="Moving an employee requires access to both locations and signs out existing employee sessions."
      />
      <EmployeeForm employee={employee} locations={locations} />
    </div>
  );
}
