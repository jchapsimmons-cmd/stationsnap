import { AiDraftPanel } from "@/components/sops/ai-draft-panel";
import { Card, PageHeader } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getSop, hasDraftVersion } from "@/server/sops/service";
import { listAiJobsForSop } from "@/server/sops/ai-jobs";

export default async function SopAiDraftPage({ params }: { params: Promise<{ sopId: string }> }) {
  const { sopId } = await params;
  const session = await requireManagerPage(`/manager/sops/${sopId}/ai`);
  const sop = await getSop(session, sopId);
  const draftInProgress = sop.status === "published" ? await hasDraftVersion(session, sopId) : true;
  const canGenerate = sop.status === "draft" || draftInProgress;

  if (!canGenerate) {
    return (
      <div className="page-stack">
        <PageHeader
          title={`AI draft · ${sop.version.title}`}
          description="Start a new draft before generating from a video."
        />
        <Card>
          <p>
            This SOP has no draft version open right now. Start a new draft from the SOP overview
            page, then come back here.
          </p>
        </Card>
      </div>
    );
  }

  const jobs = await listAiJobsForSop(session, sopId);

  return (
    <div className="page-stack">
      <PageHeader
        title={`AI draft · ${sop.version.title}`}
        description="Turn a training video into a starting draft. A manager always reviews and applies the result before it becomes part of this SOP's draft, and publishing still goes through the normal publish flow."
      />
      <AiDraftPanel
        sopId={sopId}
        stepsHref={`/manager/sops/${sopId}/steps`}
        initialJobs={jobs.map((entry) => ({
          job: {
            id: entry.job.id,
            status: entry.job.status,
            failedStep: entry.job.failedStep,
            stepAttempts: entry.job.stepAttempts,
            maxStepAttempts: entry.job.maxStepAttempts,
            lastErrorMessage: entry.job.lastErrorMessage,
            transcript: entry.job.transcript,
            createdAt: entry.job.createdAt.toISOString(),
            readyAt: entry.job.readyAt ? entry.job.readyAt.toISOString() : null,
          },
          outputs: entry.outputs.map((output) => ({
            id: output.id,
            jobId: output.jobId,
            schemaVersion: output.schemaVersion,
            structuredDraft: output.structuredDraft as {
              title: string;
              description: string;
              materials: {
                kind: "material" | "ingredient";
                name: string;
                quantity: string;
                unit: string;
              }[];
              warnings: { text: string }[];
              steps: {
                title: string;
                instruction: string;
                warning: string;
                quantity: string;
                unit: string;
                equipmentSetting: string;
                timerSeconds: number | null;
              }[];
            },
            acceptanceState: output.acceptanceState,
            createdAt: output.createdAt.toISOString(),
          })),
        }))}
      />
    </div>
  );
}
