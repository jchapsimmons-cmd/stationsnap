import Link from "next/link";
import { categoryLabel } from "@/components/sops/options";
import { Card, EmptyState, PageHeader, ProgressIndicator, StatusBadge } from "@/components/ui";
import { requireEmployeePage } from "@/server/auth/authorization";
import { listStationsForEmployee } from "@/server/management/service";
import { listRecentSopsForEmployee } from "@/server/sops/service";

export default async function EmployeeFoundationPage() {
  const session = await requireEmployeePage("/employee");
  const [stations, recent] = await Promise.all([
    listStationsForEmployee(session),
    listRecentSopsForEmployee(session, 6),
  ]);

  return (
    <div className="page-stack employee-home">
      <PageHeader
        title="Your StationSnap home"
        description="Your employee session is separate from manager access and checked by the server."
        actions={<StatusBadge tone="success">Signed in</StatusBadge>}
      />
      <div className="metric-grid">
        <Card>
          <p className="eyebrow">Stations</p>
          <h2>{stations.length} available</h2>
          <Link className="button button--secondary" href="/employee/stations">
            Browse stations
          </Link>
        </Card>
        <Card>
          <p className="eyebrow">Training</p>
          <h2>No assignments yet</h2>
          <ProgressIndicator value={0} label="Current progress" />
        </Card>
      </div>
      {recent.length > 0 ? (
        <Card>
          <h2>Recently viewed</h2>
          <div className="record-grid">
            {recent.map((item) => (
              <Link className="record-card" href={`/employee/sops/${item.id}`} key={item.id}>
                <span className="record-card__body">
                  <strong>{item.title}</strong>
                  <small>
                    {categoryLabel(item.category)}
                    {item.stationName ? ` · ${item.stationName}` : ""}
                  </small>
                </span>
              </Link>
            ))}
          </div>
        </Card>
      ) : (
        <EmptyState
          title="You’re all caught up"
          description="Procedures you view and new training assignments will show here."
        />
      )}
    </div>
  );
}
