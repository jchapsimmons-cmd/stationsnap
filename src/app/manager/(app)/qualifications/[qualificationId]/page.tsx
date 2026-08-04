import Link from "next/link";
import {
  QUALIFICATION_STATUS_LABELS,
  QUALIFICATION_STATUS_TONE,
} from "@/components/training/status";
import { RevokeQualificationForm } from "@/components/training/revoke-qualification-form";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getQualificationDetail } from "@/server/training/qualifications";

function formatDate(value: Date | null): string {
  if (!value) return "Never expires";
  return value.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function formatInstant(value: Date): string {
  return value.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function ManagerQualificationDetailPage({
  params,
}: {
  params: Promise<{ qualificationId: string }>;
}) {
  const { qualificationId } = await params;
  const session = await requireManagerPage(`/manager/qualifications/${qualificationId}`);
  const detail = await getQualificationDetail(session, qualificationId);

  return (
    <div className="page-stack">
      <PageHeader
        title={detail.definition.name}
        description={`${detail.employeeName} · #${detail.employeeNumber} · ${detail.locationName}`}
        actions={
          <Link className="button button--secondary" href="/manager/qualifications">
            Back to qualifications
          </Link>
        }
      />

      <Card>
        <div className="action-row">
          <StatusBadge tone={QUALIFICATION_STATUS_TONE[detail.status] ?? "neutral"}>
            {QUALIFICATION_STATUS_LABELS[detail.status] ?? detail.status}
          </StatusBadge>
          {detail.status === "active" && detail.isExpired && (
            <StatusBadge tone="danger">Expired</StatusBadge>
          )}
        </div>
      </Card>

      <div className="detail-grid">
        <Card>
          <p className="eyebrow">Path</p>
          <Link href={`/manager/training/paths/${detail.path.id}`}>{detail.path.title}</Link>
        </Card>
        <Card>
          <p className="eyebrow">Awarded</p>
          <strong>{formatInstant(detail.awardedAt)}</strong>
        </Card>
        <Card>
          <p className="eyebrow">Expires</p>
          <strong>{formatDate(detail.expiresAt)}</strong>
        </Card>
        {detail.status === "revoked" && (
          <>
            <Card>
              <p className="eyebrow">Revoked</p>
              <strong>{detail.revokedAt ? formatInstant(detail.revokedAt) : "—"}</strong>
            </Card>
            {detail.revokedNote && (
              <Card>
                <p className="eyebrow">Revocation note</p>
                <strong>{detail.revokedNote}</strong>
              </Card>
            )}
          </>
        )}
      </div>

      <Card className="form-section">
        <h2>Supporting sessions</h2>
        {detail.supportingSessions.length === 0 ? (
          <EmptyState
            title="No supporting sessions"
            description="This qualification has no linked training sessions."
          />
        ) : (
          <ul className="mobile-list" aria-label="Supporting sessions">
            {detail.supportingSessions.map((row) => (
              <li key={row.sessionId}>
                <div>
                  <strong>
                    {row.sopTitle} · v{row.sopVersionNumber}
                  </strong>
                  <span>{row.completedAt ? formatInstant(row.completedAt) : "—"}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {detail.canRevoke && <RevokeQualificationForm qualificationId={detail.id} />}
    </div>
  );
}
