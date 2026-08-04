import Link from "next/link";
import { CATEGORY_OPTIONS, categoryLabel, STATUS_OPTIONS } from "@/components/sops/options";
import { DataTable, PageHeader, Pagination, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listLocations } from "@/server/management/service";
import { getSopVersionHistoryReport } from "@/server/sops/service";
import { sopVersionHistoryReportQuerySchema } from "@/server/sops/schemas";

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

export default async function SopVersionHistoryReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireManagerPage("/manager/reports/sop-versions");
  const params = await searchParams;
  const raw: Record<string, string> = {
    search: typeof params["search"] === "string" ? params["search"] : "",
    category: typeof params["category"] === "string" ? params["category"] : "",
    status: typeof params["status"] === "string" ? params["status"] : "",
    locationId: typeof params["locationId"] === "string" ? params["locationId"] : "",
    page: typeof params["page"] === "string" ? params["page"] : "1",
  };
  const query = sopVersionHistoryReportQuerySchema.parse(raw);
  const [{ items, total }, locations] = await Promise.all([
    getSopVersionHistoryReport(session, query),
    listLocations(session),
  ]);

  return (
    <div className="page-stack">
      <PageHeader
        title="SOP version history"
        description="Every draft, published, and archived version across your SOPs, newest first."
        actions={
          <a
            className="button button--secondary"
            href={`/api/management/reports/sop-versions/export${buildQueryString(raw, {})}`}
          >
            Export CSV
          </a>
        }
      />
      <form className="filter-bar" action="/manager/reports/sop-versions">
        <label>
          Search
          <input name="search" type="search" defaultValue={query.search} placeholder="Title" />
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
          Status
          <select name="status" defaultValue={query.status}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((option) => (
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
        <button className="button button--secondary" type="submit">
          Filter
        </button>
      </form>
      <DataTable
        caption="SOP version history"
        rows={items}
        getRowKey={(row) => row.id}
        columns={[
          {
            key: "title",
            header: "Title",
            render: (row) => <Link href={`/manager/sops/${row.sopId}`}>{row.title}</Link>,
          },
          { key: "version", header: "Version", render: (row) => `v${row.versionNumber}` },
          { key: "category", header: "Category", render: (row) => categoryLabel(row.category) },
          { key: "location", header: "Location", render: (row) => row.locationName },
          {
            key: "status",
            header: "Status",
            render: (row) => (
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
            ),
          },
          { key: "published", header: "Published", render: (row) => formatDate(row.publishedAt) },
        ]}
      />
      <Pagination
        page={query.page}
        pageSize={query.pageSize}
        total={total}
        buildHref={(page) =>
          `/manager/reports/sop-versions${buildQueryString(raw, { page: String(page) })}`
        }
      />
    </div>
  );
}
