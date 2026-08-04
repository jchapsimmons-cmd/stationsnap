import { TrainingPathForm } from "@/components/training/path-form";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listLocations, listStations } from "@/server/management/service";
import { listPublishedSopsForPathBuilder } from "@/server/training/qualifications";

export default async function NewTrainingPathPage() {
  const session = await requireManagerPage("/manager/training/paths/new");
  const [allLocations, stations, sops] = await Promise.all([
    listLocations(session),
    listStations(session, { locationId: "", status: "active" }),
    listPublishedSopsForPathBuilder(session),
  ]);
  const locations = allLocations.filter((location) => location.status === "active");

  return (
    <div className="page-stack">
      <PageHeader
        title="New training path"
        description="Sequence published SOPs into a path that awards a qualification when they're all completed."
      />
      {locations.length === 0 ? (
        <EmptyState
          title="No active locations"
          description="An active permitted location is required before a training path can be created."
        />
      ) : (
        <TrainingPathForm locations={locations} stations={stations} sops={sops} />
      )}
    </div>
  );
}
