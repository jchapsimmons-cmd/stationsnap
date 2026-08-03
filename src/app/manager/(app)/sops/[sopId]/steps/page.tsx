import { CreateDraftButton } from "@/components/sops/create-draft-button";
import { StepEditor } from "@/components/sops/step-editor";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getSop, getSopDraft, hasDraftVersion } from "@/server/sops/service";

export default async function SopStepsPage({ params }: { params: Promise<{ sopId: string }> }) {
  const { sopId } = await params;
  const session = await requireManagerPage(`/manager/sops/${sopId}/steps`);
  const sop = await getSop(session, sopId);

  if (sop.status === "archived") {
    return (
      <div className="page-stack">
        <PageHeader
          title={`Steps · ${sop.version.title}`}
          description="Archived SOPs are read-only."
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
          title={`Steps · ${sop.version.title}`}
          description="This SOP is published and immutable. Start a new draft to edit its steps."
          actions={<StatusBadge tone="success">{sop.status}</StatusBadge>}
        />
        <Card>
          <h2>Start a new draft</h2>
          <CreateDraftButton sopId={sop.id} redirectTo={`/manager/sops/${sop.id}/steps`} />
        </Card>
      </div>
    );
  }

  const draft = sop.status === "draft" ? sop : await getSopDraft(session, sopId);

  return (
    <div className="page-stack">
      <PageHeader
        title={`Steps · ${draft.version.title}`}
        description="Build the procedure one step at a time."
      />
      <StepEditor
        sopId={draft.id}
        initialSteps={draft.steps}
        initialRevision={draft.version.revision}
        readOnly={false}
      />
    </div>
  );
}
