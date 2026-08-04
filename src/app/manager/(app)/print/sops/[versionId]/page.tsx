import { PrintActions } from "@/components/print/print-actions";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getSopVersionForPrint } from "@/server/sops/service";

export default async function SopVersionPrintPage({
  params,
}: {
  params: Promise<{ versionId: string }>;
}) {
  const { versionId } = await params;
  const session = await requireManagerPage(`/manager/print/sops/${versionId}`);
  const detail = await getSopVersionForPrint(session, versionId);

  return (
    <div className="page-stack print-sheet">
      <PageHeader
        title={detail.version.title}
        description={`Version ${detail.version.versionNumber} · ${detail.locationName}${
          detail.stationName ? ` · ${detail.stationName}` : ""
        }`}
        actions={<PrintActions pdfHref={`/manager/print/sops/${versionId}/pdf`} />}
      />
      <Card className="print-sheet__section">
        <StatusBadge tone={detail.version.status === "published" ? "success" : "neutral"}>
          {detail.version.status}
        </StatusBadge>
        <p>
          {detail.category} · {detail.version.difficulty}
          {detail.version.estimatedMinutes ? ` · ${detail.version.estimatedMinutes} min` : ""}
        </p>
        {detail.version.changeSummary && (
          <p className="muted">Change summary: {detail.version.changeSummary}</p>
        )}
      </Card>

      {detail.warnings.length > 0 && (
        <Card className="print-sheet__section">
          <h2>Warnings</h2>
          <ul>
            {detail.warnings.map((warning) => (
              <li key={warning.id}>{warning.text}</li>
            ))}
          </ul>
        </Card>
      )}

      {detail.materials.length > 0 && (
        <Card className="print-sheet__section">
          <h2>Materials &amp; ingredients</h2>
          <ul>
            {detail.materials.map((material) => (
              <li key={material.id}>
                {material.name}
                {material.quantity || material.unit
                  ? ` — ${[material.quantity, material.unit].filter(Boolean).join(" ")}`
                  : ""}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="print-sheet__section">
        <h2>Steps</h2>
        <ol className="print-sheet__steps">
          {detail.steps.map((step) => (
            <li key={step.id} className="print-sheet__step">
              <p className="print-sheet__step-title">
                {step.title || `Step ${step.displayOrder}`}
                {!step.isRequired && <span className="muted"> (optional)</span>}
              </p>
              <p>{step.instruction}</p>
              {step.imageFile && step.imageFile.mediaType === "image" && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="print-sheet__step-image"
                  src={`/api/management/media/${step.imageFile.id}`}
                  alt=""
                />
              )}
              <p className="muted">
                {[
                  step.quantity || step.unit
                    ? [step.quantity, step.unit].filter(Boolean).join(" ")
                    : null,
                  step.equipmentSetting ? `Setting: ${step.equipmentSetting}` : null,
                  step.timerSeconds ? `Timer: ${Math.round(step.timerSeconds / 60)} min` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {step.warning && <p className="print-sheet__step-warning">Warning: {step.warning}</p>}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
