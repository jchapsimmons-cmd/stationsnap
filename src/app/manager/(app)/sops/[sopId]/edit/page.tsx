import { CreateDraftButton } from "@/components/sops/create-draft-button";
import { SopDraftForm } from "@/components/sops/draft-form";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listLocations, listStations } from "@/server/management/service";
import { getSop, getSopDraft, hasDraftVersion } from "@/server/sops/service";

export default async function EditSopPage({ params }: { params: Promise<{ sopId: string }> }) {
  const { sopId } = await params;
  const session = await requireManagerPage(`/manager/sops/${sopId}/edit`);
  const sop = await getSop(session, sopId);

  if (sop.status === "archived") {
    return (
      <div className="page-stack">
        <PageHeader
          title={`Edit ${sop.version.title}`}
          description="Archived SOPs are read-only. Reactivate the location or contact an owner to make changes."
          actions={<StatusBadge tone="warning">{sop.status}</StatusBadge>}
        />
      </div>
    );
  }

  const draftExists = sop.status === "draft" ? true : await hasDraftVersion(session, sopId);
  if (sop.status === "published" && !draftExists) {
    return (
      <div className="page-stack">
        <PageHeader
          title={`Edit ${sop.version.title}`}
          description="This SOP is published and immutable. Start a new draft to make changes."
          actions={<StatusBadge tone="success">{sop.status}</StatusBadge>}
        />
        <Card>
          <h2>Start a new draft</h2>
          <p>
            Starting a draft clones the current published version {sop.version.versionNumber} so you
            can edit it safely. Publishing it later creates version {sop.version.versionNumber + 1}.
          </p>
          <CreateDraftButton sopId={sop.id} redirectTo={`/manager/sops/${sop.id}/edit`} />
        </Card>
      </div>
    );
  }

  const draft = sop.status === "draft" ? sop : await getSopDraft(session, sopId);
  const [locations, stations] = await Promise.all([
    listLocations(session),
    listStations(session, { locationId: "", status: "" }),
  ]);

  return (
    <div className="page-stack">
      <PageHeader
        title={`Edit ${draft.version.title}`}
        description={
          sop.status === "draft"
            ? "Changes save automatically."
            : `Editing a draft of version ${draft.version.versionNumber}. Changes save automatically.`
        }
      />
      <SopDraftForm
        sopId={draft.id}
        locations={locations}
        stations={stations}
        initial={{
          revision: draft.version.revision,
          title: draft.version.title,
          description: draft.version.description,
          category: draft.version.category,
          locationId: draft.locationId,
          stationId: draft.stationId ?? "",
          estimatedMinutes: draft.version.estimatedMinutes,
          difficulty: draft.version.difficulty,
          coverImageFile: draft.version.coverImageFile,
          sourceVideoFile: draft.version.sourceVideoFile,
          materials: draft.materials.map((material) => ({
            kind: material.kind,
            name: material.name,
            quantity: material.quantity,
            unit: material.unit,
          })),
          warnings: draft.warnings.map((warning) => ({ text: warning.text })),
        }}
      />
    </div>
  );
}
