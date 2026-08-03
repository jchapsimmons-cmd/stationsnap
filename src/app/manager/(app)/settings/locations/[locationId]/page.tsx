import Link from "next/link";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getLocation, listEmployees, listStations } from "@/server/management/service";
export default async function LocationDetailPage({
  params,
}: {
  params: Promise<{ locationId: string }>;
}) {
  const { locationId } = await params;
  const session = await requireManagerPage(`/manager/settings/locations/${locationId}`);
  const [location, stationRows, employeeRows] = await Promise.all([
    getLocation(session, locationId),
    listStations(session, { locationId, status: "" }),
    listEmployees(session, { search: "", locationId, status: "" }),
  ]);
  return (
    <div className="page-stack">
      <PageHeader
        title={location.name}
        description={`${location.timezone} · employee code ${location.accessSlug}`}
        actions={
          <Link
            className="button button--secondary"
            href={`/manager/settings/locations/${location.id}/edit`}
          >
            Edit location
          </Link>
        }
      />
      <div className="detail-grid">
        <Card>
          <p className="eyebrow">Status</p>
          <StatusBadge tone={location.status === "active" ? "success" : "warning"}>
            {location.status}
          </StatusBadge>
        </Card>
        <Card>
          <p className="eyebrow">Stations</p>
          <p className="metric-value">{stationRows.length}</p>
        </Card>
        <Card>
          <p className="eyebrow">Employees</p>
          <p className="metric-value">{employeeRows.length}</p>
        </Card>
      </div>
    </div>
  );
}
