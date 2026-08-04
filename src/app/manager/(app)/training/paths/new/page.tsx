import { PathForm } from "@/components/training/path-form";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listLocations, listStations } from "@/server/management/service";
import { listTrainableSops } from "@/server/training/service";

export default async function NewTrainingPathPage() {
  const session = await requireManagerPage("/manager/training/paths/new");
  const [locations, stations, sops] = await Promise.all([
    listLocations(session),
    listStations(session, { locationId: "", status: "active" }),
    listTrainableSops(session),
  ]);
  const activeLocations = locations.filter((location) => location.status === "active");

  return (
    <div className="page-stack">
      <PageHeader
        title="New training path"
        description="Define the ordered procedures employees must complete to earn a qualification."
      />
      {activeLocations.length === 0 ? (
        <EmptyState
          title="No active locations"
          description="An active permitted location is required before a training path can be created."
        />
      ) : (
        <PathForm locations={activeLocations} stations={stations} sops={sops} />
      )}
    </div>
  );
}
