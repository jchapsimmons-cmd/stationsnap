import { ChecklistForm } from "@/components/checklists/checklist-form";
import { PageHeader } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getChecklistDetail } from "@/server/checklists/service";
import { listLocations, listStations } from "@/server/management/service";

export default async function EditChecklistPage({
  params,
}: {
  params: Promise<{ checklistId: string }>;
}) {
  const { checklistId } = await params;
  const session = await requireManagerPage(`/manager/checklists/${checklistId}/edit`);
  const [checklist, locations, stations] = await Promise.all([
    getChecklistDetail(session, checklistId),
    listLocations(session),
    listStations(session, { locationId: "", status: "active" }),
  ]);

  return (
    <div className="page-stack">
      <PageHeader
        title={`Edit ${checklist.title}`}
        description="Location and station are fixed once a checklist is created. Disable it from here instead."
      />
      <ChecklistForm checklist={checklist} locations={locations} stations={stations} />
    </div>
  );
}
