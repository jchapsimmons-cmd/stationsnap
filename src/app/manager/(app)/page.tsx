import Link from "next/link";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listEmployees, listLocations, listStations } from "@/server/management/service";

export default async function ManagerFoundationPage() {
  const session = await requireManagerPage("/manager");
  const [locations, stations, employees] = await Promise.all([
    listLocations(session),
    listStations(session, { locationId: "", status: "" }),
    listEmployees(session, { search: "", locationId: "", status: "" }),
  ]);
  return (
    <div className="page-stack">
      <PageHeader
        title="Restaurant setup"
        description="Manage the locations, stations, and people available to your account."
        actions={
          <StatusBadge tone="success">
            {session.role === "owner" ? "Owner access" : "Scoped manager"}
          </StatusBadge>
        }
      />
      <div className="metric-grid">
        <Card>
          <p className="eyebrow">Locations</p>
          <p className="metric-value">{locations.length}</p>
          <Link href="/manager/settings/locations">Manage locations</Link>
        </Card>
        <Card>
          <p className="eyebrow">Stations</p>
          <p className="metric-value">{stations.length}</p>
          <Link href="/manager/settings/stations">Manage stations</Link>
        </Card>
        <Card>
          <p className="eyebrow">Employees</p>
          <p className="metric-value">{employees.length}</p>
          <Link href="/manager/employees">Manage employees</Link>
        </Card>
      </div>
    </div>
  );
}
