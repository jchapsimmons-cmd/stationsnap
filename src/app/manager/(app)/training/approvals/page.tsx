import Link from "next/link";
import {
  APPROVAL_STATUS_LABELS,
  APPROVAL_STATUS_TONE,
  TRAINING_MODE_LABELS,
} from "@/components/training/status";
import { EmptyState, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listLocations } from "@/server/management/service";
import { listApprovalQueue } from "@/server/training/approvals";
import {
  approvalQueueQuerySchema,
  approvalSubmissionStatusValues,
} from "@/server/training/schemas";

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

function formatSubmittedAt(submittedAt: Date): string {
  return submittedAt.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function ManagerApprovalQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireManagerPage("/manager/training/approvals");
  const params = await searchParams;
  const raw: Record<string, string> = {
    status: typeof params["status"] === "string" ? params["status"] : "pending",
    locationId: typeof params["locationId"] === "string" ? params["locationId"] : "",
  };
  const query = approvalQueueQuerySchema.parse(raw);
  const [rows, locations] = await Promise.all([
    listApprovalQueue(session, query),
    listLocations(session),
  ]);

  return (
    <div className="page-stack">
      <PageHeader
        title="Approval queue"
        description={`${rows.length} ${rows.length === 1 ? "submission" : "submissions"} matching this view.`}
      />
      <Tabs
        label="Submission status"
        items={approvalSubmissionStatusValues.map((status) => ({
          href: `/manager/training/approvals${buildQueryString(raw, { status })}`,
          label: APPROVAL_STATUS_LABELS[status] ?? status,
          active: query.status === status,
        }))}
      />
      <form className="filter-bar" action="/manager/training/approvals">
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
          title="Nothing to review"
          description="Submissions appear here when a training attempt needs manager approval."
        />
      ) : (
        <div className="record-grid">
          {rows.map((row) => (
            <Link
              className="record-card"
              href={`/manager/training/approvals/${row.id}`}
              key={row.id}
            >
              <span className="record-card__body">
                <strong>{row.employeeName}</strong>
                <small>
                  {row.sopTitle} · v{row.sopVersionNumber} ·{" "}
                  {TRAINING_MODE_LABELS[row.mode] ?? row.mode} · {row.locationName}
                </small>
                <small>
                  Submission {row.submissionGeneration} · attempt {row.attemptNumber} ·{" "}
                  {formatSubmittedAt(row.submittedAt)}
                </small>
              </span>
              <StatusBadge tone={APPROVAL_STATUS_TONE[row.status] ?? "neutral"}>
                {APPROVAL_STATUS_LABELS[row.status] ?? row.status}
              </StatusBadge>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
