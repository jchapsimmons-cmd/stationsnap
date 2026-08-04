import Link from "next/link";
import {
  CHECKLIST_RUN_STATUS_LABELS,
  CHECKLIST_RUN_STATUS_TONE,
} from "@/components/checklists/status";
import { EmptyState, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listChecklistRuns } from "@/server/checklists/runs";
import { checklistRunQuerySchema, checklistRunStatusValues } from "@/server/checklists/schemas";
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

export default async function ManagerChecklistRunsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireManagerPage("/manager/checklist-runs");
  const params = await searchParams;
  const raw: Record<string, string> = {
    status: typeof params["status"] === "string" ? params["status"] : "awaiting_approval",
    locationId: typeof params["locationId"] === "string" ? params["locationId"] : "",
  };
  const query = checklistRunQuerySchema.parse(raw);
  const [rows, locations] = await Promise.all([
    listChecklistRuns(session, query),
    listLocations(session),
  ]);

  return (
    <div className="page-stack">
      <PageHeader
        title="Checklist runs"
        description={`${rows.length} ${rows.length === 1 ? "run" : "runs"} matching this view.`}
      />
      <Tabs
        label="Run status"
        items={checklistRunStatusValues.map((status) => ({
          href: `/manager/checklist-runs${buildQueryString(raw, { status })}`,
          label: CHECKLIST_RUN_STATUS_LABELS[status] ?? status,
          active: query.status === status,
        }))}
      />
      <form className="filter-bar" action="/manager/checklist-runs">
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
          title="No runs found"
          description="Checklist runs appear here as employees start and complete them."
        />
      ) : (
        <div className="record-grid">
          {rows.map((row) => (
            <Link className="record-card" href={`/manager/checklist-runs/${row.id}`} key={row.id}>
              <span className="record-card__body">
                <strong>{row.employeeName}</strong>
                <small>
                  {row.checklistTitle} · {row.locationName}
                </small>
                <small>
                  Started {formatInstant(row.startedAt)}
                  {row.submittedAt ? ` · submitted ${formatInstant(row.submittedAt)}` : ""}
                </small>
              </span>
              <StatusBadge tone={CHECKLIST_RUN_STATUS_TONE[row.status] ?? "neutral"}>
                {CHECKLIST_RUN_STATUS_LABELS[row.status] ?? row.status}
              </StatusBadge>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
