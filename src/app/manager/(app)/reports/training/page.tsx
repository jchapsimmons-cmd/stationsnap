import { ASSIGNMENT_STATUS_LABELS, ASSIGNMENT_STATUS_TONE } from "@/components/training/status";
import { DataTable, PageHeader, Pagination, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listLocations } from "@/server/management/service";
import {
  trainingAssignmentStatusValues,
  trainingProgressReportQuerySchema,
} from "@/server/training/schemas";
import { getTrainingProgressReport } from "@/server/training/service";

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

function formatDate(value: Date | null): string {
  if (!value) return "—";
  return value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function TrainingProgressReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireManagerPage("/manager/reports/training");
  const params = await searchParams;
  const raw: Record<string, string> = {
    status: typeof params["status"] === "string" ? params["status"] : "",
    locationId: typeof params["locationId"] === "string" ? params["locationId"] : "",
    search: typeof params["search"] === "string" ? params["search"] : "",
    page: typeof params["page"] === "string" ? params["page"] : "1",
  };
  const query = trainingProgressReportQuerySchema.parse(raw);
  const [{ items, total }, locations] = await Promise.all([
    getTrainingProgressReport(session, query),
    listLocations(session),
  ]);

  return (
    <div className="page-stack">
      <PageHeader
        title="Training progress"
        description="Assignment status across employees and SOPs, newest first."
        actions={
          <a
            className="button button--secondary"
            href={`/api/management/reports/training/export${buildQueryString(raw, {})}`}
          >
            Export CSV
          </a>
        }
      />
      <form className="filter-bar" action="/manager/reports/training">
        <label>
          Search
          <input
            name="search"
            type="search"
            defaultValue={query.search}
            placeholder="Employee or SOP"
          />
        </label>
        <label>
          Status
          <select name="status" defaultValue={query.status}>
            <option value="">All statuses</option>
            {trainingAssignmentStatusValues.map((status) => (
              <option key={status} value={status}>
                {ASSIGNMENT_STATUS_LABELS[status] ?? status}
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
        caption="Training progress"
        rows={items}
        getRowKey={(row) => row.id}
        columns={[
          { key: "employee", header: "Employee", render: (row) => row.employeeName },
          {
            key: "sop",
            header: "SOP",
            render: (row) => `${row.sopTitle} (v${row.versionNumber})`,
          },
          { key: "location", header: "Location", render: (row) => row.locationName },
          {
            key: "status",
            header: "Status",
            render: (row) => (
              <StatusBadge tone={ASSIGNMENT_STATUS_TONE[row.status] ?? "neutral"}>
                {ASSIGNMENT_STATUS_LABELS[row.status] ?? row.status}
              </StatusBadge>
            ),
          },
          { key: "due", header: "Due", render: (row) => formatDate(row.dueAt) },
          { key: "updated", header: "Updated", render: (row) => formatDate(row.updatedAt) },
        ]}
      />
      <Pagination
        page={query.page}
        pageSize={query.pageSize}
        total={total}
        buildHref={(page) =>
          `/manager/reports/training${buildQueryString(raw, { page: String(page) })}`
        }
      />
    </div>
  );
}
