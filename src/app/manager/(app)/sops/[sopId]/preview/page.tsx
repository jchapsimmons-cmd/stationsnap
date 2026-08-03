import { categoryLabel, difficultyLabel } from "@/components/sops/options";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { previewSop } from "@/server/sops/service";

export default async function SopPreviewPage({ params }: { params: Promise<{ sopId: string }> }) {
  const { sopId } = await params;
  const session = await requireManagerPage(`/manager/sops/${sopId}/preview`);
  const sop = await previewSop(session, sopId);

  return (
    <div className="page-stack">
      <PageHeader
        title="Employee preview"
        description="This is a read-only preview of the employee view."
      />
      <div className="preview-shell">
        {sop.version.coverImageFile && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/management/media/${sop.version.coverImageFile.id}`} alt="" />
        )}
        <p className="eyebrow">{categoryLabel(sop.category)}</p>
        <h1>{sop.version.title}</h1>
        <div className="action-row">
          <StatusBadge tone="info">{difficultyLabel(sop.version.difficulty)}</StatusBadge>
          {sop.version.estimatedMinutes && (
            <StatusBadge tone="neutral">{sop.version.estimatedMinutes} min</StatusBadge>
          )}
        </div>
        {sop.version.description && <p>{sop.version.description}</p>}
        {sop.warnings.length > 0 && (
          <Card>
            <h2>Warnings</h2>
            <ul>
              {sop.warnings.map((warning) => (
                <li key={warning.id}>{warning.text}</li>
              ))}
            </ul>
          </Card>
        )}
        {sop.materials.length > 0 && (
          <Card>
            <h2>Materials and ingredients</h2>
            <ul>
              {sop.materials.map((material) => (
                <li key={material.id}>
                  {material.name}
                  {material.quantity ? ` — ${material.quantity} ${material.unit}` : ""}
                </li>
              ))}
            </ul>
          </Card>
        )}
        {sop.steps.map((step) => (
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
    </div>
  );
}
