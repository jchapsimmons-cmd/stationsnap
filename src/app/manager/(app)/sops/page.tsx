import Link from "next/link";
import { Plus } from "@phosphor-icons/react/ssr";
import { EmptyState, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import { CATEGORY_OPTIONS, categoryLabel, STATUS_OPTIONS } from "@/components/sops/options";
import { requireManagerPage } from "@/server/auth/authorization";
import { listLocations, listStations } from "@/server/management/service";
import { sopQuerySchema } from "@/server/sops/schemas";
import { listSops } from "@/server/sops/service";

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

export default async function SopsLibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireManagerPage("/manager/sops");
  const params = await searchParams;
  const raw: Record<string, string> = {
    search: typeof params["search"] === "string" ? params["search"] : "",
    category: typeof params["category"] === "string" ? params["category"] : "",
    locationId: typeof params["locationId"] === "string" ? params["locationId"] : "",
    stationId: typeof params["stationId"] === "string" ? params["stationId"] : "",
    status: typeof params["status"] === "string" ? params["status"] : "draft",
    cursor: typeof params["cursor"] === "string" ? params["cursor"] : "",
  };
  const query = sopQuerySchema.parse(raw);
  const [{ items, nextCursor }, locations, stations] = await Promise.all([
    listSops(session, query),
    listLocations(session),
    listStations(session, { locationId: "", status: "" }),
  ]);

  return (
    <div className="page-stack">
      <PageHeader
        title="SOPs"
        description={`${items.length} ${items.length === 1 ? "procedure" : "procedures"} on this page.`}
        actions={
          <Link className="button button--primary" href="/manager/sops/new">
            <Plus size={19} aria-hidden="true" />
            New SOP
          </Link>
        }
      />
      <Tabs
        label="SOP status"
        items={STATUS_OPTIONS.map((option) => ({
          href: `/manager/sops${buildQueryString(raw, { status: option.value, cursor: "" })}`,
          label: option.label,
          active: query.status === option.value,
        }))}
      />
      <form className="filter-bar" action="/manager/sops">
        <input type="hidden" name="status" value={query.status} />
        <label>
          Search
          <input
            name="search"
            type="search"
            defaultValue={query.search}
            placeholder="Title or description"
          />
        </label>
        <label>
          Category
          <select name="category" defaultValue={query.category}>
            <option value="">All categories</option>
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
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
        <label>
          Station
          <select name="stationId" defaultValue={query.stationId}>
            <option value="">All stations</option>
            {stations.map((station) => (
              <option key={station.id} value={station.id}>
                {station.name}
              </option>
            ))}
          </select>
        </label>
        <button className="button button--secondary" type="submit">
          Search
        </button>
      </form>
      {items.length === 0 ? (
        <EmptyState
          title={
            query.search || query.category || query.locationId || query.stationId
              ? "No matching SOPs"
              : "No SOPs yet"
          }
          description={
            query.search || query.category || query.locationId || query.stationId
              ? "Change the search or filters and try again."
              : "Create the first standard operating procedure."
          }
        />
      ) : (
        <div className="record-grid">
          {items.map((row) => (
            <Link className="record-card" href={`/manager/sops/${row.id}`} key={row.id}>
              <span className="record-card__body">
                <strong>{row.title}</strong>
                <small>
                  {categoryLabel(row.category)} · {row.locationName}
                  {row.stationName ? ` · ${row.stationName}` : ""}
                </small>
              </span>
              <StatusBadge
                tone={
                  row.status === "published"
                    ? "success"
                    : row.status === "archived"
                      ? "warning"
                      : "info"
                }
              >
                {row.status}
              </StatusBadge>
            </Link>
          ))}
        </div>
      )}
      {nextCursor && (
        <Link
          className="button button--secondary"
          href={`/manager/sops${buildQueryString(raw, { cursor: nextCursor })}`}
        >
          Load more
        </Link>
      )}
    </div>
  );
}
