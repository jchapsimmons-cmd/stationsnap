import { CreateDraftButton } from "@/components/sops/create-draft-button";
import { TrainingConfigForm } from "@/components/sops/training-config-form";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import {
  getSop,
  getSopDraft,
  getStepTrainingRequirementsDraft,
  getTrainingConfigDraft,
  hasDraftVersion,
} from "@/server/sops/service";

export default async function SopTrainingPage({ params }: { params: Promise<{ sopId: string }> }) {
  const { sopId } = await params;
  const session = await requireManagerPage(`/manager/sops/${sopId}/training`);
  const sop = await getSop(session, sopId);

  if (sop.status === "archived") {
    return (
      <div className="page-stack">
        <PageHeader
          title={`Training · ${sop.version.title}`}
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
          title={`Training · ${sop.version.title}`}
          description="This SOP is published and immutable. Start a new draft to edit its training configuration."
          actions={<StatusBadge tone="success">{sop.status}</StatusBadge>}
        />
        <Card>
          <h2>Start a new draft</h2>
          <CreateDraftButton sopId={sop.id} redirectTo={`/manager/sops/${sop.id}/training`} />
        </Card>
      </div>
    );
  }

  const draft = sop.status === "draft" ? sop : await getSopDraft(session, sopId);
  const [{ revision, config }, { requirementsByStepId }] = await Promise.all([
    getTrainingConfigDraft(session, sopId),
    getStepTrainingRequirementsDraft(session, sopId),
  ]);

  return (
    <div className="page-stack">
      <PageHeader
        title={`Training · ${draft.version.title}`}
        description="Configure how employees train on this SOP before writing any questions."
      />
      <TrainingConfigForm
        sopId={draft.id}
        initialRevision={revision}
        initialConfig={config}
        steps={draft.steps.map((step) => ({
          id: step.id,
          displayOrder: step.displayOrder,
          title: step.title,
          timerSeconds: step.timerSeconds,
          hasVideo: Boolean(step.videoFile),
        }))}
        initialRequirementsByStepId={requirementsByStepId}
      />
    </div>
  );
}
