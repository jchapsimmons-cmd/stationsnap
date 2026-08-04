import {
  ACTIVITY_TYPE_LABELS,
  summarizeActivityPayload,
} from "@/components/management/activity-labels";
import { EmptyState, Pagination, PageHeader } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { activityQuerySchema } from "@/server/events-schemas";
import { domainEventTypeValues, listActivity } from "@/server/events";
import { listLocations } from "@/server/management/service";

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

function formatInstant(value: Date): string {
  return value.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function ManagerActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireManagerPage("/manager/activity");
  const params = await searchParams;
  const raw: Record<string, string> = {
    locationId: typeof params["locationId"] === "string" ? params["locationId"] : "",
    type: typeof params["type"] === "string" ? params["type"] : "",
    page: typeof params["page"] === "string" ? params["page"] : "1",
  };
  const query = activityQuerySchema.parse(raw);
  const [{ items, total }, locations] = await Promise.all([
    listActivity(session, query),
    listLocations(session),
  ]);

  return (
    <div className="page-stack">
      <PageHeader
        title="Activity"
        description="Business-lifecycle events across your permitted locations, newest first."
      />
      <form className="filter-bar" action="/manager/activity">
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
          Event type
          <select name="type" defaultValue={query.type}>
            <option value="">All types</option>
            {domainEventTypeValues.map((type) => (
              <option key={type} value={type}>
                {ACTIVITY_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        <button className="button button--secondary" type="submit">
          Filter
        </button>
      </form>
      {items.length === 0 ? (
        <EmptyState
          title="No activity yet"
          description="Published SOPs, training completions, approvals, and checklist submissions will appear here."
        />
      ) : (
        <div className="record-grid">
          {items.map((item) => (
            <div className="record-card" key={item.id}>
              <span className="record-card__body">
                <strong>{ACTIVITY_TYPE_LABELS[item.type] ?? item.type}</strong>
                <small>
                  {item.label} · {item.locationName}
                </small>
                <small>
                  {formatInstant(item.occurredAt)}
                  {summarizeActivityPayload(item.payload)
                    ? ` · ${summarizeActivityPayload(item.payload)}`
                    : ""}
                </small>
              </span>
            </div>
          ))}
        </div>
      )}
      <Pagination
        page={query.page}
        pageSize={query.pageSize}
        total={total}
        buildHref={(page) => `/manager/activity${buildQueryString(raw, { page: String(page) })}`}
      />
    </div>
  );
}
