import Link from "next/link";
import { QUALIFICATION_STATUS_LABELS } from "@/components/training/status";
import { QualificationRevokeForm } from "@/components/training/qualification-revoke-form";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import {
  getManagerDisplayName,
  resolveAssignmentIdsForSessions,
} from "@/server/training/qualification-view-helpers";
import { getQualificationDetail } from "@/server/training/qualifications";

function formatDate(value: Date | null): string | null {
  if (!value) return null;
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

  const [assignmentIdBySession, revokedByName] = await Promise.all([
    resolveAssignmentIdsForSessions(
      session.organizationId,
      detail.supportingSessions.map((row) => row.sessionId),
    ),
    detail.revokedByManagerUserId
      ? getManagerDisplayName(session, detail.revokedByManagerUserId)
      : Promise.resolve(null),
  ]);

  const statusTone =
    detail.status === "revoked" ? "danger" : detail.isExpired ? "warning" : "success";

  return (
    <div className="page-stack">
      <PageHeader
        title={detail.definition.name}
        description={`${detail.employeeName} · #${detail.employeeNumber} · ${detail.locationName}`}
      />

      <Card>
        <div className="action-row">
          <StatusBadge tone={statusTone}>
            {detail.status === "revoked"
              ? QUALIFICATION_STATUS_LABELS["revoked"]
              : detail.isExpired
                ? "Expired"
                : QUALIFICATION_STATUS_LABELS["active"]}
          </StatusBadge>
        </div>
        {detail.definition.description && <p>{detail.definition.description}</p>}
      </Card>

      <div className="detail-grid">
        <Card>
          <p className="eyebrow">Employee</p>
          <Link href={`/manager/employees/${detail.employeeId}`}>{detail.employeeName}</Link>
        </Card>
        <Card>
          <p className="eyebrow">Training path</p>
          <Link href={`/manager/training/paths/${detail.path.id}`}>{detail.path.title}</Link>
        </Card>
        <Card>
          <p className="eyebrow">Awarded</p>
          <strong>{formatDate(detail.awardedAt) ?? "—"}</strong>
        </Card>
        <Card>
          <p className="eyebrow">Expiry</p>
          <strong>{formatDate(detail.expiresAt) ?? "Never expires"}</strong>
        </Card>
      </div>

      <Card className="form-section">
        <h2>Supporting sessions</h2>
        <p className="muted">
          The completed training sessions that satisfy this qualification&apos;s required
          procedures.
        </p>
        {detail.supportingSessions.length === 0 ? (
          <p className="muted">No supporting sessions on record.</p>
        ) : (
          <ul className="mobile-list" aria-label="Supporting sessions">
            {detail.supportingSessions.map((row) => {
              const assignmentId = assignmentIdBySession.get(row.sessionId);
              return (
                <li key={row.sessionId}>
                  <div>
                    <strong>
                      {row.sopTitle} · v{row.sopVersionNumber}
                    </strong>
                    <span>
                      {row.completedAt ? `Completed ${formatInstant(row.completedAt)}` : "—"}
                    </span>
                  </div>
                  {assignmentId && (
                    <Link href={`/manager/training/assignments/${assignmentId}`}>
                      View assignment
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {detail.status === "revoked" ? (
        <Card className="form-section">
          <h2>Revocation history</h2>
          <p>
            Revoked {detail.revokedAt ? formatInstant(detail.revokedAt) : "—"}
            {revokedByName ? ` by ${revokedByName}` : ""}.
          </p>
          {detail.revokedNote && <p>{detail.revokedNote}</p>}
        </Card>
      ) : (
        <QualificationRevokeForm qualificationId={detail.id} />
      )}
    </div>
  );
}
