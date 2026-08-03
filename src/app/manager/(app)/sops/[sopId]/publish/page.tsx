import { PublishForm } from "@/components/sops/publish-panel";
import { Card, PageHeader } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listLocations } from "@/server/management/service";
import { getPublishReadiness } from "@/server/sops/service";

export default async function SopPublishPage({ params }: { params: Promise<{ sopId: string }> }) {
  const { sopId } = await params;
  const session = await requireManagerPage(`/manager/sops/${sopId}/publish`);
  const [readiness, locations] = await Promise.all([
    getPublishReadiness(session, sopId),
    listLocations(session),
  ]);

  return (
    <div className="page-stack">
      <PageHeader
        title="Publish SOP"
        description={
          readiness.isUpdate
            ? `Publishing creates version ${readiness.versionNumber} and immutably retires the current one.`
            : "Publishing makes this SOP immutable and read-only until you start a new draft."
        }
      />
      <Card>
        <h2>Checklist</h2>
        {(() => {
          // The change summary is addressed inline in the form below, not in this checklist.
          const structuralIssues = readiness.issues.filter(
            (issue) => issue.code !== "change_summary",
          );
          if (!readiness.hasDraft) {
            return <p>This SOP does not have a draft to publish. Start a new draft first.</p>;
          }
          if (structuralIssues.length === 0) {
            return (
              <ul className="validation-list">
                <li className="validation-list__ok">This SOP is ready to publish.</li>
              </ul>
            );
          }
          return (
            <ul className="validation-list">
              {structuralIssues.map((issue) => (
                <li key={issue.code}>{issue.message}</li>
              ))}
            </ul>
          );
        })()}
      </Card>
      {readiness.hasDraft && (
        <PublishForm
          sopId={sopId}
          revision={readiness.revision}
          disabled={!readiness.canPublish}
          isUpdate={readiness.isUpdate}
          locations={locations}
        />
      )}
    </div>
  );
}
