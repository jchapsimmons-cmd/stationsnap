import { TranslationEditor } from "@/components/sops/translation-editor";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getSop } from "@/server/sops/service";
import { getTranslationMatrix } from "@/server/sops/translations";

export default async function SopTranslationsPage({
  params,
}: {
  params: Promise<{ sopId: string }>;
}) {
  const { sopId } = await params;
  const session = await requireManagerPage(`/manager/sops/${sopId}/translations`);
  const sop = await getSop(session, sopId);

  if (sop.status !== "published") {
    return (
      <div className="page-stack">
        <PageHeader
          title={`Translations · ${sop.version.title}`}
          description="Translations apply to the current published version. Publish this SOP first."
          actions={<StatusBadge tone="info">{sop.status}</StatusBadge>}
        />
      </div>
    );
  }

  const matrix = await getTranslationMatrix(session, sopId, "es");
  const untranslatedCount = matrix.rows.filter((row) => row.status === "untranslated").length;

  return (
    <div className="page-stack">
      <PageHeader
        title={`Translations · ${sop.version.title}`}
        description={`English / Spanish review and approval for version ${matrix.versionNumber}. Quantities, units, equipment settings, and timers are never translated. ${untranslatedCount} of ${matrix.rows.length} fields still need a Spanish translation.`}
      />
      <Card>
        <p>
          Republishing this SOP creates a new version with new content; translations entered here
          apply only to version {matrix.versionNumber} and will need to be re-entered for a future
          republish.
        </p>
      </Card>
      <TranslationEditor sopId={sopId} targetLocale="es" initialRows={matrix.rows} />
    </div>
  );
}
