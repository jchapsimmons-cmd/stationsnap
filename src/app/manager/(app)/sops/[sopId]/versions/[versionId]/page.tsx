import Link from "next/link";
import { RestoreVersionButton } from "@/components/sops/restore-version-button";
import { categoryLabel, difficultyLabel } from "@/components/sops/options";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getSopVersionDetail } from "@/server/sops/service";

function statusTone(status: string): "success" | "warning" | "info" {
  if (status === "published") return "success";
  if (status === "archived") return "warning";
  return "info";
}

function retrainingRuleLabel(
  rule: NonNullable<Awaited<ReturnType<typeof getSopVersionDetail>>["retrainingRule"]>,
): string {
  if (rule.ruleType === "none") return "No retraining required";
  if (rule.ruleType === "all_qualified") return "All currently qualified employees";
  if (rule.ruleType === "selected_roles") return `Roles: ${rule.jobRoles.join(", ")}`;
  return `Locations: ${rule.locations.map((location) => location.locationName).join(", ")}`;
}

export default async function SopVersionDetailPage({
  params,
}: {
  params: Promise<{ sopId: string; versionId: string }>;
}) {
  const { sopId, versionId } = await params;
  const session = await requireManagerPage(`/manager/sops/${sopId}/versions/${versionId}`);
  const version = await getSopVersionDetail(session, sopId, versionId);
  const canRestore = version.version.status !== "draft" && version.status !== "archived";

  return (
    <div className="page-stack">
      <PageHeader
        title={`v${version.version.versionNumber} · ${version.version.title}`}
        description={`${categoryLabel(version.category)} · ${version.locationName}${version.stationName ? ` · ${version.stationName}` : ""}`}
        actions={
          <div className="action-row">
            <StatusBadge tone={statusTone(version.version.status)}>
              {version.version.status}
            </StatusBadge>
            {version.version.status !== "draft" && (
              <Link className="button button--secondary" href={`/manager/print/sops/${versionId}`}>
                Print
              </Link>
            )}
          </div>
        }
      />
      {version.version.changeSummary && (
        <Card>
          <h2>What changed</h2>
          <p>{version.version.changeSummary}</p>
        </Card>
      )}
      {version.retrainingRule && (
        <Card>
          <h2>Retraining rule</h2>
          <p>{retrainingRuleLabel(version.retrainingRule)}</p>
        </Card>
      )}
      <div className="preview-shell">
        {version.version.coverImageFile && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/management/media/${version.version.coverImageFile.id}`} alt="" />
        )}
        <div className="action-row">
          <StatusBadge tone="info">{difficultyLabel(version.version.difficulty)}</StatusBadge>
          {version.version.estimatedMinutes && (
            <StatusBadge tone="neutral">{version.version.estimatedMinutes} min</StatusBadge>
          )}
        </div>
        {version.version.description && <p>{version.version.description}</p>}
        {version.warnings.length > 0 && (
          <Card>
            <h2>Warnings</h2>
            <ul>
              {version.warnings.map((warning) => (
                <li key={warning.id}>{warning.text}</li>
              ))}
            </ul>
          </Card>
        )}
        {version.materials.length > 0 && (
          <Card>
            <h2>Materials and ingredients</h2>
            <ul>
              {version.materials.map((material) => (
                <li key={material.id}>
                  {material.name}
                  {material.quantity ? ` — ${material.quantity} ${material.unit}` : ""}
                </li>
              ))}
            </ul>
          </Card>
        )}
        {version.steps.map((step) => (
          <Card key={step.id}>
            <p className="eyebrow">Step {step.displayOrder}</p>
            {step.title && <h2>{step.title}</h2>}
            <p>{step.instruction}</p>
            {step.imageFile && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/management/media/${step.imageFile.id}`} alt="" />
            )}
            {step.videoFile && (
              <video src={`/api/management/media/${step.videoFile.id}`} controls />
            )}
            {step.warning && (
              <p role="alert" className="form-status form-status--error">
                {step.warning}
              </p>
            )}
            {step.timerSeconds && (
              <StatusBadge tone="neutral">{step.timerSeconds}s timer</StatusBadge>
            )}
            {!step.isRequired && <StatusBadge tone="neutral">Optional</StatusBadge>}
          </Card>
        ))}
      </div>
      {canRestore && (
        <Card>
          <h2>Restore this version</h2>
          <p>Cloning into a new draft lets you edit and republish without altering history.</p>
          <RestoreVersionButton
            sopId={sopId}
            versionId={versionId}
            versionNumber={version.version.versionNumber}
          />
        </Card>
      )}
    </div>
  );
}
