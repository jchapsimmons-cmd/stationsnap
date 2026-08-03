import { SopDraftForm } from "@/components/sops/draft-form";
import { PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listLocations, listStations } from "@/server/management/service";
import { getSop } from "@/server/sops/service";

export default async function EditSopPage({ params }: { params: Promise<{ sopId: string }> }) {
  const { sopId } = await params;
  const session = await requireManagerPage(`/manager/sops/${sopId}/edit`);
  const [sop, locations, stations] = await Promise.all([
    getSop(session, sopId),
    listLocations(session),
    listStations(session, { locationId: "", status: "" }),
  ]);

  if (sop.version.status !== "draft") {
    return (
      <div className="page-stack">
        <PageHeader
          title={`Edit ${sop.version.title}`}
          description="Published and archived SOPs are read-only in this phase."
          actions={<StatusBadge tone="info">{sop.status}</StatusBadge>}
        />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader title={`Edit ${sop.version.title}`} description="Changes save automatically." />
      <SopDraftForm
        sopId={sop.id}
        locations={locations}
        stations={stations}
        initial={{
          revision: sop.version.revision,
          title: sop.version.title,
          description: sop.version.description,
          category: sop.version.category,
          locationId: sop.locationId,
          stationId: sop.stationId ?? "",
          estimatedMinutes: sop.version.estimatedMinutes,
          difficulty: sop.version.difficulty,
          coverImageFile: sop.version.coverImageFile,
          sourceVideoFile: sop.version.sourceVideoFile,
          materials: sop.materials.map((material) => ({
            kind: material.kind,
            name: material.name,
            quantity: material.quantity,
            unit: material.unit,
          })),
          warnings: sop.warnings.map((warning) => ({ text: warning.text })),
        }}
      />
    </div>
  );
}
