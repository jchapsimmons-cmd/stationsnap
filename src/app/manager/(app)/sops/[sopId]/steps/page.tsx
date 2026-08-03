import { StepEditor } from "@/components/sops/step-editor";
import { PageHeader } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getSop } from "@/server/sops/service";

export default async function SopStepsPage({ params }: { params: Promise<{ sopId: string }> }) {
  const { sopId } = await params;
  const session = await requireManagerPage(`/manager/sops/${sopId}/steps`);
  const sop = await getSop(session, sopId);

  return (
    <div className="page-stack">
      <PageHeader
        title={`Steps · ${sop.version.title}`}
        description="Build the procedure one step at a time."
      />
      <StepEditor
        sopId={sop.id}
        initialSteps={sop.steps}
        initialRevision={sop.version.revision}
        readOnly={sop.version.status !== "draft"}
      />
    </div>
  );
}
