import { ChecklistForm } from "@/components/checklists/checklist-form";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listLocations, listStations } from "@/server/management/service";

export default async function NewChecklistPage() {
  const session = await requireManagerPage("/manager/checklists/new");
  const [locations, stations] = await Promise.all([
    listLocations(session),
    listStations(session, { locationId: "", status: "active" }),
  ]);
  const activeLocations = locations.filter((location) => location.status === "active");

  return (
    <div className="page-stack">
      <PageHeader
        title="New checklist"
        description="Define an ordered checklist and the requirements each item must satisfy."
      />
      {activeLocations.length === 0 ? (
        <EmptyState
          title="No active locations"
          description="An active permitted location is required before a checklist can be created."
        />
      ) : (
        <ChecklistForm locations={activeLocations} stations={stations} />
      )}
    </div>
  );
}
