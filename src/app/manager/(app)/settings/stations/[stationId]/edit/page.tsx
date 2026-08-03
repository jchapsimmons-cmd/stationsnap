import { StationForm } from "@/components/management/forms";
import { PageHeader } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getStation, listLocations } from "@/server/management/service";
export default async function EditStationPage({
  params,
}: {
  params: Promise<{ stationId: string }>;
}) {
  const { stationId } = await params;
  const session = await requireManagerPage(`/manager/settings/stations/${stationId}/edit`);
  const [station, locations] = await Promise.all([
    getStation(session, stationId),
    listLocations(session),
  ]);
  return (
    <div className="page-stack">
      <PageHeader
        title={`Edit ${station.name}`}
        description="Archive a station when it is no longer used."
      />
      <StationForm station={station} locations={locations} />
    </div>
  );
}
