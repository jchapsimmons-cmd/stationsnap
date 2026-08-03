import Link from "next/link";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { stationQuerySchema } from "@/server/management/schemas";
import { listLocations, listStations } from "@/server/management/service";

export default async function StationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireManagerPage("/manager/settings/stations");
  const params = await searchParams;
  const query = stationQuerySchema.parse({
    locationId: typeof params["locationId"] === "string" ? params["locationId"] : "",
    status: typeof params["status"] === "string" ? params["status"] : "",
  });
  const [rows, locationRows] = await Promise.all([
    listStations(session, query),
    listLocations(session),
  ]);
  return (
    <div className="page-stack">
      <PageHeader
        title="Stations"
        description="Organize procedures by the place work happens."
        actions={
          <Link className="button button--primary" href="/manager/settings/stations/new">
            Add station
          </Link>
        }
      />
      <form className="filter-bar">
        <label>
          Location
          <select name="locationId" defaultValue={query.locationId}>
            <option value="">All permitted</option>
            {locationRows.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select name="status" defaultValue={query.status}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="disabled">Archived</option>
          </select>
        </label>
        <button className="button button--secondary" type="submit">
          Apply filters
        </button>
      </form>
      {rows.length === 0 ? (
        <EmptyState
          title="No stations found"
          description="Create a station or change the selected filters."
        />
      ) : (
        <div className="record-grid">
          {rows.map((row) => (
            <Link
              className="record-card"
              href={`/manager/settings/stations/${row.id}`}
              key={row.id}
            >
              <span>
                <strong>{row.name}</strong>
                <small>
                  {row.locationName} · order {row.displayOrder}
                </small>
              </span>
              <StatusBadge tone={row.status === "active" ? "success" : "warning"}>
                {row.status === "active" ? "active" : "archived"}
              </StatusBadge>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
