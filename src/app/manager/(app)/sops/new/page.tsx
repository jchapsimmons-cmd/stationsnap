import { SopCreateForm } from "@/components/sops/create-form";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listLocations, listStations } from "@/server/management/service";

export default async function NewSopPage() {
  const session = await requireManagerPage("/manager/sops/new");
  const [locations, stations] = await Promise.all([
    listLocations(session),
    listStations(session, { locationId: "", status: "active" }),
  ]);
  const activeLocations = locations.filter((location) => location.status === "active");
  return (
    <div className="page-stack">
      <PageHeader title="New SOP" description="Create a manual draft, then add its steps." />
      {activeLocations.length ? (
        <SopCreateForm locations={activeLocations} stations={stations} />
      ) : (
        <EmptyState
          title="No active locations"
          description="An active permitted location is required before an SOP can be created."
        />
      )}
    </div>
  );
}
