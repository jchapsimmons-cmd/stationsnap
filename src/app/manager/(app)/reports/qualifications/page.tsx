import Link from "next/link";
import {
  QUALIFICATION_CLASSIFICATION_LABELS,
  QUALIFICATION_CLASSIFICATION_TONE,
} from "@/components/training/status";
import { DataTable, PageHeader, Pagination, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listLocations } from "@/server/management/service";
import {
  qualificationOverviewTabValues,
  qualificationsReportQuerySchema,
} from "@/server/training/paths-schemas";
import { getQualificationsReport } from "@/server/training/qualifications";

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

export default async function QualificationsReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireManagerPage("/manager/reports/qualifications");
  const params = await searchParams;
  const raw: Record<string, string> = {
    tab: typeof params["tab"] === "string" ? params["tab"] : "",
    locationId: typeof params["locationId"] === "string" ? params["locationId"] : "",
    page: typeof params["page"] === "string" ? params["page"] : "1",
  };
  const query = qualificationsReportQuerySchema.parse(raw);
  const [{ items, total }, locations] = await Promise.all([
    getQualificationsReport(session, query),
    listLocations(session),
  ]);

  return (
    <div className="page-stack">
      <PageHeader
        title="Qualifications"
        description="Qualification status by employee across your permitted locations."
        actions={
          <a
            className="button button--secondary"
            href={`/api/management/reports/qualifications/export${buildQueryString(raw, {})}`}
          >
            Export CSV
          </a>
        }
      />
      <form className="filter-bar" action="/manager/reports/qualifications">
        <label>
          Status
          <select name="tab" defaultValue={query.tab}>
            <option value="">All statuses</option>
            {qualificationOverviewTabValues.map((tab) => (
              <option key={tab} value={tab}>
                {QUALIFICATION_CLASSIFICATION_LABELS[tab] ?? tab}
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
        caption="Qualification status"
        rows={items}
        getRowKey={(row) => `${row.employeeId}:${row.definitionId}`}
        columns={[
          { key: "employee", header: "Employee", render: (row) => row.employeeName },
          { key: "qualification", header: "Qualification", render: (row) => row.definitionName },
          { key: "location", header: "Location", render: (row) => row.locationName },
          {
            key: "status",
            header: "Status",
            render: (row) => (
              <StatusBadge
                tone={
                  QUALIFICATION_CLASSIFICATION_TONE[
                    row.isExpiringSoon ? "expiring" : row.classification
                  ] ?? "neutral"
                }
              >
                {QUALIFICATION_CLASSIFICATION_LABELS[
                  row.isExpiringSoon ? "expiring" : row.classification
                ] ?? row.classification}
              </StatusBadge>
            ),
          },
          { key: "awarded", header: "Awarded", render: (row) => formatDate(row.awardedAt) },
          { key: "expires", header: "Expires", render: (row) => formatDate(row.expiresAt) },
          {
            key: "detail",
            header: "",
            render: (row) =>
              row.qualificationId ? (
                <Link href={`/manager/qualifications/${row.qualificationId}`}>View</Link>
              ) : (
                "—"
              ),
          },
        ]}
      />
      <Pagination
        page={query.page}
        pageSize={query.pageSize}
        total={total}
        buildHref={(page) =>
          `/manager/reports/qualifications${buildQueryString(raw, { page: String(page) })}`
        }
      />
    </div>
  );
}
