import Link from "next/link";
import { ArchiveButton } from "@/components/sops/archive-button";
import { categoryLabel, difficultyLabel } from "@/components/sops/options";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getSop } from "@/server/sops/service";

export default async function SopOverviewPage({ params }: { params: Promise<{ sopId: string }> }) {
  const { sopId } = await params;
  const session = await requireManagerPage(`/manager/sops/${sopId}`);
  const sop = await getSop(session, sopId);
  const isDraft = sop.version.status === "draft";

  return (
    <div className="page-stack">
      <PageHeader
        title={sop.version.title}
        description={`${categoryLabel(sop.category)} · ${sop.locationName}${sop.stationName ? ` · ${sop.stationName}` : ""}`}
        actions={
          <div className="action-row">
            <Link className="button button--secondary" href={`/manager/sops/${sop.id}/preview`}>
              Preview
            </Link>
            {isDraft && (
              <>
                <Link className="button button--secondary" href={`/manager/sops/${sop.id}/edit`}>
                  Edit details
                </Link>
                <Link className="button button--secondary" href={`/manager/sops/${sop.id}/steps`}>
                  Edit steps
                </Link>
                <Link className="button button--primary" href={`/manager/sops/${sop.id}/publish`}>
                  Publish
                </Link>
              </>
            )}
          </div>
        }
      />
      <div className="detail-grid">
        <Card>
          <p className="eyebrow">Status</p>
          <StatusBadge
            tone={
              sop.status === "published"
                ? "success"
                : sop.status === "archived"
                  ? "warning"
                  : "info"
            }
          >
            {sop.status}
          </StatusBadge>
        </Card>
        <Card>
          <p className="eyebrow">Difficulty</p>
          <strong>{difficultyLabel(sop.version.difficulty)}</strong>
        </Card>
        <Card>
          <p className="eyebrow">Estimated time</p>
          <strong>
            {sop.version.estimatedMinutes ? `${sop.version.estimatedMinutes} min` : "Not set"}
          </strong>
        </Card>
        <Card>
          <p className="eyebrow">Steps</p>
          <strong>{sop.steps.length}</strong>
        </Card>
      </div>
      {sop.version.description && (
        <Card>
          <h2>Description</h2>
          <p>{sop.version.description}</p>
        </Card>
      )}
      {sop.status !== "archived" && (
        <Card>
          <h2>Archive</h2>
          <p>Archiving retires this SOP without deleting its history.</p>
          <ArchiveButton sopId={sop.id} />
        </Card>
      )}
    </div>
  );
}
