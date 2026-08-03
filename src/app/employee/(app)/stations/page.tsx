import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireEmployeePage } from "@/server/auth/authorization";
import { listStationsForEmployee } from "@/server/management/service";

export default async function EmployeeStationsPage() {
  const session = await requireEmployeePage("/employee/stations");
  const stations = await listStationsForEmployee(session);

  return (
    <div className="page-stack">
      <PageHeader
        title="Stations"
        description="Choose a station to see its published procedures."
      />
      {stations.length === 0 ? (
        <EmptyState
          title="No stations yet"
          description="Your manager hasn't set up any stations at this location."
        />
      ) : (
        <div className="record-grid">
          {stations.map((station) => (
            <Link
              className="record-card"
              href={`/employee/stations/${station.id}`}
              key={station.id}
            >
              <span className="record-card__body">
                <strong>{station.name}</strong>
                {station.description && <small>{station.description}</small>}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
