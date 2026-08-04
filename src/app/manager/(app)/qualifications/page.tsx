import Link from "next/link";
import {
  QUALIFICATION_CLASSIFICATION_LABELS,
  QUALIFICATION_CLASSIFICATION_TONE,
} from "@/components/training/status";
import {
  DataTable,
  EmptyState,
  PageHeader,
  StatusBadge,
  Tabs,
  type DataColumn,
} from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listLocations } from "@/server/management/service";
import {
  qualificationOverviewQuerySchema,
  qualificationOverviewTabValues,
} from "@/server/training/paths-schemas";
import {
  listQualificationsOverview,
  type QualificationOverviewRow,
} from "@/server/training/qualifications";

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
  if (!value) return "Never expires";
  return value.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

const TAB_LABELS: Record<(typeof qualificationOverviewTabValues)[number], string> = {
  qualified: "Qualified",
  training: "In training",
  missing: "Missing",
  expiring: "Expiring soon",
  expired: "Expired",
};

export default async function ManagerQualificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireManagerPage("/manager/qualifications");
  const params = await searchParams;
  const raw: Record<string, string> = {
    tab: typeof params["tab"] === "string" ? params["tab"] : "qualified",
    locationId: typeof params["locationId"] === "string" ? params["locationId"] : "",
  };
  const query = qualificationOverviewQuerySchema.parse(raw);
  const [rows, locations] = await Promise.all([
    listQualificationsOverview(session, query),
    listLocations(session),
  ]);

  const columns: DataColumn<QualificationOverviewRow>[] = [
    {
      key: "employee",
      header: "Employee",
      render: (row) => (
        <span>
          {row.employeeName} <small className="muted">#{row.employeeNumber}</small>
        </span>
      ),
    },
    { key: "definition", header: "Qualification", render: (row) => row.definitionName },
    { key: "path", header: "Path", render: (row) => row.pathTitle },
    { key: "location", header: "Location", render: (row) => row.locationName },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <span className="action-row">
          <StatusBadge tone={QUALIFICATION_CLASSIFICATION_TONE[row.classification] ?? "neutral"}>
            {QUALIFICATION_CLASSIFICATION_LABELS[row.classification] ?? row.classification}
          </StatusBadge>
          {row.isExpiringSoon && <StatusBadge tone="warning">Expiring soon</StatusBadge>}
        </span>
      ),
    },
    {
      key: "awardedAt",
      header: "Awarded",
      render: (row) => (row.awardedAt ? formatDate(row.awardedAt) : "—"),
    },
    {
      key: "expiresAt",
      header: "Expires",
      render: (row) => (row.awardedAt ? formatDate(row.expiresAt) : "—"),
    },
    {
      key: "detail",
      header: "",
      render: (row) =>
        row.qualificationId ? (
          <Link href={`/manager/qualifications/${row.qualificationId}`}>View</Link>
        ) : null,
    },
  ];

  return (
    <div className="page-stack">
      <PageHeader
        title="Qualifications"
        description={`${rows.length} ${rows.length === 1 ? "row" : "rows"} matching this view.`}
      />
      <Tabs
        label="Qualification status"
        items={qualificationOverviewTabValues.map((tab) => ({
          href: `/manager/qualifications${buildQueryString(raw, { tab })}`,
          label: TAB_LABELS[tab] ?? tab,
          active: query.tab === tab,
        }))}
      />
      <form className="filter-bar" action="/manager/qualifications">
        <input type="hidden" name="tab" value={query.tab} />
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
          title="Nothing in this view"
          description="Qualification standing appears here once a training path exists and employees are working toward it."
        />
      ) : (
        <DataTable
          caption="Qualifications"
          columns={columns}
          rows={rows}
          getRowKey={(row) => `${row.definitionId}:${row.employeeId}`}
        />
      )}
    </div>
  );
}
