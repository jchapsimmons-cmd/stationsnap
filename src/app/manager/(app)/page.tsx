import Link from "next/link";
import { ACTIVITY_TYPE_LABELS } from "@/components/management/activity-labels";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listActivity } from "@/server/events";
import { listEmployees, listLocations, listStations } from "@/server/management/service";

function formatInstant(value: Date): string {
  return value.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function ManagerFoundationPage() {
  const session = await requireManagerPage("/manager");
  const [locations, stations, employees, activity] = await Promise.all([
    listLocations(session),
    listStations(session, { locationId: "", status: "" }),
    listEmployees(session, { search: "", locationId: "", status: "" }),
    listActivity(session, { page: 1, pageSize: 5 }),
  ]);
  return (
    <div className="page-stack">
      <PageHeader
        title="Restaurant setup"
        description="Manage the locations, stations, and people available to your account."
        actions={
          <StatusBadge tone="success">
            {session.role === "owner" ? "Owner access" : "Scoped manager"}
          </StatusBadge>
        }
      />
      <div className="metric-grid">
        <Card>
          <p className="eyebrow">Locations</p>
          <p className="metric-value">{locations.length}</p>
          <Link href="/manager/settings/locations">Manage locations</Link>
        </Card>
        <Card>
          <p className="eyebrow">Stations</p>
          <p className="metric-value">{stations.length}</p>
          <Link href="/manager/settings/stations">Manage stations</Link>
        </Card>
        <Card>
          <p className="eyebrow">Employees</p>
          <p className="metric-value">{employees.length}</p>
          <Link href="/manager/employees">Manage employees</Link>
        </Card>
      </div>
      <Card>
        <p className="eyebrow">Recent activity</p>
        {activity.items.length === 0 ? (
          <EmptyState
            title="No activity yet"
            description="Published SOPs, training completions, and approvals will appear here."
          />
        ) : (
          <ul className="mobile-list" aria-label="Recent activity">
            {activity.items.map((item) => (
              <li key={item.id}>
                <strong>{ACTIVITY_TYPE_LABELS[item.type] ?? item.type}</strong>
                <small>
                  {item.label} · {formatInstant(item.occurredAt)}
                </small>
              </li>
            ))}
          </ul>
        )}
        <Link href="/manager/activity">View all activity</Link>
      </Card>
    </div>
  );
}
