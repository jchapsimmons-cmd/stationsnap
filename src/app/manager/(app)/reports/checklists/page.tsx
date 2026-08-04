import Link from "next/link";
import {
  CHECKLIST_RUN_STATUS_LABELS,
  CHECKLIST_RUN_STATUS_TONE,
} from "@/components/checklists/status";
import { DataTable, PageHeader, Pagination, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import {
  checklistCompletionReportQuerySchema,
  checklistRunStatusValues,
} from "@/server/checklists/schemas";
import { getChecklistCompletionReport } from "@/server/checklists/runs";
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

function formatInstant(value: Date | null): string {
  if (!value) return "—";
  return value.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function ChecklistCompletionReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireManagerPage("/manager/reports/checklists");
  const params = await searchParams;
  const raw: Record<string, string> = {
    status: typeof params["status"] === "string" ? params["status"] : "",
    locationId: typeof params["locationId"] === "string" ? params["locationId"] : "",
    search: typeof params["search"] === "string" ? params["search"] : "",
    page: typeof params["page"] === "string" ? params["page"] : "1",
  };
  const query = checklistCompletionReportQuerySchema.parse(raw);
  const [{ items, total }, locations] = await Promise.all([
    getChecklistCompletionReport(session, query),
    listLocations(session),
  ]);

  return (
    <div className="page-stack">
      <PageHeader
        title="Checklist completion"
        description="Run status by checklist and location, newest first."
        actions={
          <a
            className="button button--secondary"
            href={`/api/management/reports/checklists/export${buildQueryString(raw, {})}`}
          >
            Export CSV
          </a>
        }
      />
      <form className="filter-bar" action="/manager/reports/checklists">
        <label>
          Search
          <input
            name="search"
            type="search"
            defaultValue={query.search}
            placeholder="Employee or checklist"
          />
        </label>
        <label>
          Status
          <select name="status" defaultValue={query.status}>
            <option value="">All statuses</option>
            {checklistRunStatusValues.map((status) => (
              <option key={status} value={status}>
                {CHECKLIST_RUN_STATUS_LABELS[status] ?? status}
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
        <button className="button button--secondary" type="submit">
          Filter
        </button>
      </form>
      <DataTable
        caption="Checklist completion"
        rows={items}
        getRowKey={(row) => row.id}
        columns={[
          { key: "employee", header: "Employee", render: (row) => row.employeeName },
          { key: "checklist", header: "Checklist", render: (row) => row.checklistTitle },
          { key: "location", header: "Location", render: (row) => row.locationName },
          {
            key: "status",
            header: "Status",
            render: (row) => (
              <StatusBadge tone={CHECKLIST_RUN_STATUS_TONE[row.status] ?? "neutral"}>
                {CHECKLIST_RUN_STATUS_LABELS[row.status] ?? row.status}
              </StatusBadge>
            ),
          },
          { key: "started", header: "Started", render: (row) => formatInstant(row.startedAt) },
          {
            key: "completed",
            header: "Completed",
            render: (row) => formatInstant(row.completedAt),
          },
          {
            key: "detail",
            header: "",
            render: (row) => <Link href={`/manager/checklist-runs/${row.id}`}>View</Link>,
          },
        ]}
      />
      <Pagination
        page={query.page}
        pageSize={query.pageSize}
        total={total}
        buildHref={(page) =>
          `/manager/reports/checklists${buildQueryString(raw, { page: String(page) })}`
        }
      />
    </div>
  );
}
