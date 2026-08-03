import Link from "next/link";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getEmployee } from "@/server/management/service";
export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ employeeId: string }>;
}) {
  const { employeeId } = await params;
  const session = await requireManagerPage(`/manager/employees/${employeeId}`);
  const employee = await getEmployee(session, employeeId);
  return (
    <div className="page-stack">
      <PageHeader
        title={employee.displayName}
        description={`Employee #${employee.employeeNumber} · ${employee.locationName}`}
        actions={
          <div className="action-row">
            <Link
              className="button button--secondary"
              href={`/manager/employees/${employee.id}/pin`}
            >
              Reset PIN
            </Link>
            <Link
              className="button button--primary"
              href={`/manager/employees/${employee.id}/edit`}
            >
              Edit employee
            </Link>
          </div>
        }
      />
      <div className="detail-grid">
        <Card>
          <p className="eyebrow">Access</p>
          <StatusBadge tone={employee.status === "active" ? "success" : "warning"}>
            {employee.status}
          </StatusBadge>
        </Card>
        <Card>
          <p className="eyebrow">Job role</p>
          <strong>{employee.jobRole}</strong>
        </Card>
        <Card>
          <p className="eyebrow">Language</p>
          <strong>{employee.language === "es" ? "Spanish" : "English"}</strong>
        </Card>
      </div>
      <Card>
        <h2>Training summary</h2>
        <p>Training records will appear here after the training phases are built.</p>
        <StatusBadge tone="neutral">No training assigned</StatusBadge>
      </Card>
    </div>
  );
}
