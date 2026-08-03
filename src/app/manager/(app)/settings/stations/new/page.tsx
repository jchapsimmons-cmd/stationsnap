import { StationForm } from "@/components/management/forms";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listLocations } from "@/server/management/service";
export default async function NewStationPage() {
  const session = await requireManagerPage("/manager/settings/stations/new");
  const locations = (await listLocations(session)).filter((row) => row.status === "active");
  return (
    <div className="page-stack">
      <PageHeader title="Add station" description="Assign the station to one permitted location." />
      {locations.length ? (
        <StationForm locations={locations} />
      ) : (
        <EmptyState
          title="No active locations"
          description="An active permitted location is required before a station can be created."
        />
      )}
    </div>
  );
}
