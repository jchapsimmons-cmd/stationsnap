import { APPROVAL_DECISION_LABELS, APPROVAL_STATUS_TONE } from "@/components/training/status";
import { DataTable, PageHeader, Pagination, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listLocations } from "@/server/management/service";
import {
  approvalHistoryDecisionValues,
  approvalHistoryReportQuerySchema,
} from "@/server/reports-schemas";
import { getApprovalHistoryReport } from "@/server/reports";

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

export default async function ApprovalHistoryReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireManagerPage("/manager/reports/approvals");
  const params = await searchParams;
  const raw: Record<string, string> = {
    decision: typeof params["decision"] === "string" ? params["decision"] : "",
    locationId: typeof params["locationId"] === "string" ? params["locationId"] : "",
    page: typeof params["page"] === "string" ? params["page"] : "1",
  };
  const query = approvalHistoryReportQuerySchema.parse(raw);
  const [{ items, total }, locations] = await Promise.all([
    getApprovalHistoryReport(session, query),
    listLocations(session),
  ]);

  return (
    <div className="page-stack">
      <PageHeader
        title="Approval decisions"
        description="Training and checklist approval history across your permitted locations, newest first."
        actions={
          <a
            className="button button--secondary"
            href={`/api/management/reports/approvals/export${buildQueryString(raw, {})}`}
          >
            Export CSV
          </a>
        }
      />
      <form className="filter-bar" action="/manager/reports/approvals">
        <label>
          Decision
          <select name="decision" defaultValue={query.decision}>
            <option value="">All decisions</option>
            {approvalHistoryDecisionValues.map((decision) => (
              <option key={decision} value={decision}>
                {APPROVAL_DECISION_LABELS[decision] ?? decision}
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
        caption="Approval decisions"
        rows={items}
        getRowKey={(row) => `${row.kind}:${row.id}`}
        columns={[
          {
            key: "kind",
            header: "Kind",
            render: (row) => (row.kind === "training" ? "Training" : "Checklist"),
          },
          { key: "subject", header: "Subject", render: (row) => row.subjectTitle },
          { key: "employee", header: "Employee", render: (row) => row.employeeName },
          { key: "location", header: "Location", render: (row) => row.locationName },
          {
            key: "decision",
            header: "Decision",
            render: (row) => (
              <StatusBadge tone={APPROVAL_STATUS_TONE[row.decision] ?? "neutral"}>
                {APPROVAL_DECISION_LABELS[row.decision] ?? row.decision}
              </StatusBadge>
            ),
          },
          { key: "decidedBy", header: "Decided by", render: (row) => row.decidedByName },
          { key: "decidedAt", header: "Decided", render: (row) => formatInstant(row.decidedAt) },
        ]}
      />
      <Pagination
        page={query.page}
        pageSize={query.pageSize}
        total={total}
        buildHref={(page) =>
          `/manager/reports/approvals${buildQueryString(raw, { page: String(page) })}`
        }
      />
    </div>
  );
}
