import Link from "next/link";
import { Plus } from "@phosphor-icons/react/ssr";
import {
  TRAINING_PATH_STATUS_LABELS,
  TRAINING_PATH_STATUS_TONE,
} from "@/components/training/status";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listLocations } from "@/server/management/service";
import { trainingPathQuerySchema } from "@/server/training/paths-schemas";
import { countPathItems } from "@/server/training/qualification-view-helpers";
import { listPaths } from "@/server/training/qualifications";

export default async function ManagerTrainingPathsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireManagerPage("/manager/training/paths");
  const params = await searchParams;
  const query = trainingPathQuerySchema.parse({
    locationId: typeof params["locationId"] === "string" ? params["locationId"] : "",
    status: typeof params["status"] === "string" ? params["status"] : "",
  });
  const [rows, locationRows] = await Promise.all([
    listPaths(session, query),
    listLocations(session),
  ]);
  const itemCounts = await countPathItems(
    session.organizationId,
    rows.map((row) => row.id),
  );

  return (
    <div className="page-stack">
      <PageHeader
        title="Training paths"
        description={`${rows.length} ${rows.length === 1 ? "path" : "paths"} matching this view.`}
        actions={
          <Link className="button button--primary" href="/manager/training/paths/new">
            <Plus size={19} aria-hidden="true" />
            New path
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
            <option value="disabled">Disabled</option>
          </select>
        </label>
        <button className="button button--secondary" type="submit">
          Apply filters
        </button>
      </form>
      {rows.length === 0 ? (
        <EmptyState
          title="No training paths found"
          description="Create a training path or change the selected filters."
        />
      ) : (
        <div className="record-grid">
          {rows.map((row) => (
            <Link className="record-card" href={`/manager/training/paths/${row.id}`} key={row.id}>
              <span className="record-card__body">
                <strong>{row.title}</strong>
                <small>
                  {row.locationName}
                  {row.stationName ? ` · ${row.stationName}` : ""} · {itemCounts.get(row.id) ?? 0}{" "}
                  {itemCounts.get(row.id) === 1 ? "item" : "items"} · {row.definitionName}
                </small>
              </span>
              <StatusBadge tone={TRAINING_PATH_STATUS_TONE[row.status] ?? "neutral"}>
                {TRAINING_PATH_STATUS_LABELS[row.status] ?? row.status}
              </StatusBadge>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
