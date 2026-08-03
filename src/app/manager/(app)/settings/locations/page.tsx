import Link from "next/link";
import { MapPin, Plus } from "@phosphor-icons/react/ssr";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listLocations } from "@/server/management/service";

export default async function LocationsPage() {
  const session = await requireManagerPage("/manager/settings/locations");
  const rows = await listLocations(session);
  return (
    <div className="page-stack">
      <PageHeader
        title="Locations"
        description="Restaurant locations available to your account."
        actions={
          session.role === "owner" ? (
            <Link className="button button--primary" href="/manager/settings/locations/new">
              <Plus size={19} aria-hidden="true" />
              Add location
            </Link>
          ) : undefined
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          title="No permitted locations"
          description="Ask an owner to assign this manager to a location."
        />
      ) : (
        <div className="record-grid">
          {rows.map((row) => (
            <Link
              className="record-card"
              href={`/manager/settings/locations/${row.id}`}
              key={row.id}
            >
              <span className="record-avatar" aria-hidden="true">
                <MapPin size={20} />
              </span>
              <span className="record-card__body">
                <strong>{row.name}</strong>
                <small>
                  {row.timezone} · {row.accessSlug}
                </small>
              </span>
              <StatusBadge tone={row.status === "active" ? "success" : "warning"}>
                {row.status}
              </StatusBadge>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
