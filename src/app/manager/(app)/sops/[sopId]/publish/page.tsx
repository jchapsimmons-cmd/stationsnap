import { PublishButton } from "@/components/sops/publish-panel";
import { Card, PageHeader } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getPublishReadiness } from "@/server/sops/service";

export default async function SopPublishPage({ params }: { params: Promise<{ sopId: string }> }) {
  const { sopId } = await params;
  const session = await requireManagerPage(`/manager/sops/${sopId}/publish`);
  const readiness = await getPublishReadiness(session, sopId);

  return (
    <div className="page-stack">
      <PageHeader
        title="Publish SOP"
        description="Publishing makes this SOP immutable and read-only."
      />
      <Card>
        <h2>Checklist</h2>
        {readiness.status !== "draft" ? (
          <p>This SOP is {readiness.status} and cannot be published again.</p>
        ) : readiness.issues.length === 0 ? (
          <ul className="validation-list">
            <li className="validation-list__ok">This SOP is ready to publish.</li>
          </ul>
        ) : (
          <ul className="validation-list">
            {readiness.issues.map((issue) => (
              <li key={issue.code}>{issue.message}</li>
            ))}
          </ul>
        )}
      </Card>
      <PublishButton sopId={sopId} revision={readiness.revision} disabled={!readiness.canPublish} />
    </div>
  );
}
