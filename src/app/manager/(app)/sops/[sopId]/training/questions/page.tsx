import { CreateDraftButton } from "@/components/sops/create-draft-button";
import { TrainingQuestionEditor } from "@/components/sops/training-question-editor";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import {
  getSop,
  getSopDraft,
  getTrainingQuestionsDraft,
  hasDraftVersion,
} from "@/server/sops/service";

export default async function SopTrainingQuestionsPage({
  params,
}: {
  params: Promise<{ sopId: string }>;
}) {
  const { sopId } = await params;
  const session = await requireManagerPage(`/manager/sops/${sopId}/training/questions`);
  const sop = await getSop(session, sopId);

  if (sop.status === "archived") {
    return (
      <div className="page-stack">
        <PageHeader
          title={`Training questions · ${sop.version.title}`}
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
          title={`Training questions · ${sop.version.title}`}
          description="This SOP is published and immutable. Start a new draft to edit its questions."
          actions={<StatusBadge tone="success">{sop.status}</StatusBadge>}
        />
        <Card>
          <h2>Start a new draft</h2>
          <CreateDraftButton
            sopId={sop.id}
            redirectTo={`/manager/sops/${sop.id}/training/questions`}
          />
        </Card>
      </div>
    );
  }

  const draft = sop.status === "draft" ? sop : await getSopDraft(session, sopId);
  const { revision, questions } = await getTrainingQuestionsDraft(session, sopId);

  return (
    <div className="page-stack">
      <PageHeader
        title={`Training questions · ${draft.version.title}`}
        description="Step questions check comprehension right after a step; final questions appear at the end. No questions is a valid configuration."
      />
      <TrainingQuestionEditor
        sopId={draft.id}
        initialRevision={revision}
        initialQuestions={questions}
        steps={draft.steps.map((step) => ({
          id: step.id,
          displayOrder: step.displayOrder,
          title: step.title,
        }))}
      />
    </div>
  );
}
