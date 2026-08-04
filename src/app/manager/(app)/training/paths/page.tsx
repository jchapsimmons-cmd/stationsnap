import Link from "next/link";
import { Plus } from "@phosphor-icons/react/ssr";
import {
  TRAINING_PATH_STATUS_LABELS,
  TRAINING_PATH_STATUS_TONE,
} from "@/components/training/status";
import { EmptyState, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listLocations } from "@/server/management/service";
import { trainingPathQuerySchema, trainingPathStatusValues } from "@/server/training/paths-schemas";
import { listPaths } from "@/server/training/qualifications";

function buildQueryString(
  params: Record<string, string>,
  overrides: Record<string, string>,
): string {
  const merged = { ...params, ...overrides };
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export default async function ManagerTrainingPathsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireManagerPage("/manager/training/paths");
  const params = await searchParams;
  const raw: Record<string, string> = {
    status: typeof params["status"] === "string" ? params["status"] : "",
    locationId: typeof params["locationId"] === "string" ? params["locationId"] : "",
  };
  const query = trainingPathQuerySchema.parse(raw);
  const [rows, locations] = await Promise.all([listPaths(session, query), listLocations(session)]);

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
      <Tabs
        label="Path status"
        items={[
          {
            href: `/manager/training/paths${buildQueryString(raw, { status: "" })}`,
            label: "All",
            active: query.status === "",
          },
          ...trainingPathStatusValues.map((status) => ({
            href: `/manager/training/paths${buildQueryString(raw, { status })}`,
            label: TRAINING_PATH_STATUS_LABELS[status] ?? status,
            active: query.status === status,
          })),
        ]}
      />
      <form className="filter-bar" action="/manager/training/paths">
        <input type="hidden" name="status" value={query.status} />
        <label>
          Location
          <select name="locationId" defaultValue={query.locationId}>
            <option value="">All permitted</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
        <button className="button button--secondary" type="submit">
          Filter
        </button>
      </form>
      {rows.length === 0 ? (
        <EmptyState
          title="No matching training paths"
          description="Build a training path to award a qualification when its SOPs are completed."
        />
      ) : (
        <div className="record-grid">
          {rows.map((row) => (
            <Link className="record-card" href={`/manager/training/paths/${row.id}`} key={row.id}>
              <span className="record-card__body">
                <strong>{row.title}</strong>
                <small>
                  {row.definitionName} · {row.locationName}
                  {row.stationName ? ` · ${row.stationName}` : ""}
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
