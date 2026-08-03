import { EmployeeForm } from "@/components/management/forms";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listLocations } from "@/server/management/service";
export default async function NewEmployeePage() {
  const session = await requireManagerPage("/manager/employees/new");
  const locations = (await listLocations(session)).filter((row) => row.status === "active");
  return (
    <div className="page-stack">
      <PageHeader
        title="Add employee"
        description="Create an employee profile and secure initial PIN."
      />
      {locations.length ? (
        <EmployeeForm locations={locations} />
      ) : (
        <EmptyState
          title="No active locations"
          description="An active permitted location is required before an employee can be created."
        />
      )}
    </div>
  );
}
