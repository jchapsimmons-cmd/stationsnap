import Link from "next/link";
import { Plus } from "@phosphor-icons/react/ssr";
import {
  ASSIGNMENT_STATUS_LABELS,
  ASSIGNMENT_STATUS_TONE,
  TRAINING_MODE_LABELS,
} from "@/components/training/status";
import { EmptyState, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listLocations } from "@/server/management/service";
import {
  trainingAssignmentQuerySchema,
  trainingAssignmentStatusValues,
} from "@/server/training/schemas";
import { listAssignments } from "@/server/training/service";

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

function formatDueDate(dueAt: Date | null, dueTimezone: string | null): string | null {
  if (!dueAt) return null;
  return dueAt.toLocaleDateString("en-US", {
    timeZone: dueTimezone ?? "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function ManagerTrainingAssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireManagerPage("/manager/training/assignments");
  const params = await searchParams;
  const raw: Record<string, string> = {
    status: typeof params["status"] === "string" ? params["status"] : "assigned",
    locationId: typeof params["locationId"] === "string" ? params["locationId"] : "",
  };
  const query = trainingAssignmentQuerySchema.parse(raw);
  const [rows, locations] = await Promise.all([
    listAssignments(session, query),
    listLocations(session),
  ]);

  return (
    <div className="page-stack">
      <PageHeader
        title="Training assignments"
        description={`${rows.length} ${rows.length === 1 ? "assignment" : "assignments"} matching this view.`}
        actions={
          <Link className="button button--primary" href="/manager/training/assignments/new">
            <Plus size={19} aria-hidden="true" />
            New assignment
          </Link>
        }
      />
      <Tabs
        label="Assignment status"
        items={trainingAssignmentStatusValues.map((status) => ({
          href: `/manager/training/assignments${buildQueryString(raw, { status })}`,
          label: ASSIGNMENT_STATUS_LABELS[status] ?? status,
          active: query.status === status,
        }))}
      />
      <form className="filter-bar" action="/manager/training/assignments">
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
          title="No matching assignments"
          description="Assign training to employees to see it appear here."
        />
      ) : (
        <div className="record-grid">
          {rows.map((row) => {
            const dueLabel = formatDueDate(row.dueAt, row.dueTimezone);
            return (
              <Link
                className="record-card"
                href={`/manager/training/assignments/${row.id}`}
                key={row.id}
              >
                <span className="record-card__body">
                  <strong>{row.employeeName}</strong>
                  <small>
                    {row.sopTitle} · {TRAINING_MODE_LABELS[row.requiredMode] ?? row.requiredMode} ·{" "}
                    {row.locationName}
                    {dueLabel ? ` · Due ${dueLabel}` : ""}
                  </small>
                </span>
                <StatusBadge tone={ASSIGNMENT_STATUS_TONE[row.status] ?? "neutral"}>
                  {ASSIGNMENT_STATUS_LABELS[row.status] ?? row.status}
                </StatusBadge>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
