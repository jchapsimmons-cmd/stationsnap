import Link from "next/link";
import {
  QUALIFICATION_CLASSIFICATION_LABELS,
  QUALIFICATION_CLASSIFICATION_TONE,
} from "@/components/training/status";
import { EmptyState, PageHeader, StatusBadge, Tabs } from "@/components/ui";
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

function formatDate(value: Date | null): string | null {
  if (!value) return null;
  return value.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function rowBadge(row: QualificationOverviewRow): {
  tone: "neutral" | "success" | "warning" | "danger" | "info";
  label: string;
} {
  if (row.isExpiringSoon) return { tone: "warning", label: "Expiring soon" };
  return {
    tone: QUALIFICATION_CLASSIFICATION_TONE[row.classification] ?? "neutral",
    label: QUALIFICATION_CLASSIFICATION_LABELS[row.classification] ?? row.classification,
  };
}

function rowDetail(row: QualificationOverviewRow): string | null {
  if (row.classification === "qualified") {
    const awarded = formatDate(row.awardedAt);
    const expires = formatDate(row.expiresAt);
    if (row.isExpiringSoon && expires) return `Expires ${expires}`;
    return awarded ? `Awarded ${awarded}` : null;
  }
  if (row.classification === "expired") {
    const expired = formatDate(row.expiresAt);
    return expired ? `Expired ${expired}` : null;
  }
  return null;
}

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

  return (
    <div className="page-stack">
      <PageHeader
        title="Qualifications"
        description={`${rows.length} ${rows.length === 1 ? "record" : "records"} matching this view.`}
      />
      <Tabs
        label="Qualification status"
        items={qualificationOverviewTabValues.map((tab) => ({
          href: `/manager/qualifications${buildQueryString(raw, { tab })}`,
          label: QUALIFICATION_CLASSIFICATION_LABELS[tab] ?? tab,
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
          title="Nothing matches this view"
          description="Qualifications appear here once employees start training toward a training path."
        />
      ) : (
        <div className="record-grid">
          {rows.map((row) => {
            const badge = rowBadge(row);
            const detail = rowDetail(row);
            const body = (
              <span className="record-card__body">
                <strong>
                  {row.employeeName} · #{row.employeeNumber}
                </strong>
                <small>
                  {row.definitionName} · {row.locationName}
                </small>
                {detail && <small>{detail}</small>}
              </span>
            );
            const key = `${row.employeeId}:${row.definitionId}`;
            return row.qualificationId ? (
              <Link
                className="record-card"
                href={`/manager/qualifications/${row.qualificationId}`}
                key={key}
              >
                {body}
                <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
              </Link>
            ) : (
              <div className="record-card" key={key}>
                {body}
                <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
