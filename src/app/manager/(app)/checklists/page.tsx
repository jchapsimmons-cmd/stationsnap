import Link from "next/link";
import { Plus } from "@phosphor-icons/react/ssr";
import {
  CHECKLIST_STATUS_LABELS,
  CHECKLIST_STATUS_TONE,
  CHECKLIST_TYPE_LABELS,
} from "@/components/checklists/status";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { checklistQuerySchema } from "@/server/checklists/schemas";
import { countChecklistItems, listChecklists } from "@/server/checklists/service";
import { listLocations } from "@/server/management/service";

export default async function ManagerChecklistsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireManagerPage("/manager/checklists");
  const params = await searchParams;
  const query = checklistQuerySchema.parse({
    locationId: typeof params["locationId"] === "string" ? params["locationId"] : "",
    status: typeof params["status"] === "string" ? params["status"] : "",
    type: typeof params["type"] === "string" ? params["type"] : "",
  });
  const [rows, locationRows] = await Promise.all([listChecklists(session, query), listLocations(session)]);
  const itemCounts = await countChecklistItems(
    session.organizationId,
    rows.map((row) => row.id),
  );

  return (
    <div className="page-stack">
      <PageHeader
        title="Checklists"
        description={`${rows.length} ${rows.length === 1 ? "checklist" : "checklists"} matching this view.`}
        actions={
          <Link className="button button--primary" href="/manager/checklists/new">
            <Plus size={19} aria-hidden="true" />
            New checklist
          </Link>
        }
      />
      <form className="filter-bar">
        <label>
          Location
          <select name="locationId" defaultValue={query.locationId}>
            <option value="">All permitted</option>
            {locationRows.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Type
          <select name="type" defaultValue={query.type}>
            <option value="">All types</option>
            {Object.entries(CHECKLIST_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select name="status" defaultValue={query.status}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
        <button className="button button--secondary" type="submit">
          Apply filters
        </button>
      </form>
      {rows.length === 0 ? (
        <EmptyState
          title="No checklists found"
          description="Create a checklist or change the selected filters."
        />
      ) : (
        <div className="record-grid">
          {rows.map((row) => (
            <Link className="record-card" href={`/manager/checklists/${row.id}`} key={row.id}>
              <span className="record-card__body">
                <strong>{row.title}</strong>
                <small>
                  {CHECKLIST_TYPE_LABELS[row.type] ?? row.type} · {row.locationName}
                  {row.stationName ? ` · ${row.stationName}` : ""} ·{" "}
                  {itemCounts.get(row.id) ?? 0} {itemCounts.get(row.id) === 1 ? "item" : "items"}
                </small>
              </span>
              <StatusBadge tone={CHECKLIST_STATUS_TONE[row.status] ?? "neutral"}>
                {CHECKLIST_STATUS_LABELS[row.status] ?? row.status}
              </StatusBadge>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
