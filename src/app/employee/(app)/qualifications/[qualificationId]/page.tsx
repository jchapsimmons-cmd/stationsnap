import {
  QUALIFICATION_STATUS_LABELS,
  QUALIFICATION_STATUS_TONE,
} from "@/components/training/status";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireEmployeePage } from "@/server/auth/authorization";
import { getQualificationDetailForEmployee } from "@/server/training/qualifications";

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

export default async function EmployeeQualificationDetailPage({
  params,
}: {
  params: Promise<{ qualificationId: string }>;
}) {
  const { qualificationId } = await params;
  const session = await requireEmployeePage(`/employee/qualifications/${qualificationId}`);
  const detail = await getQualificationDetailForEmployee(session, qualificationId);

  return (
    <div className="page-stack">
      <PageHeader title={detail.definition.name} description={detail.path.title} />

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

      {detail.definition.description && (
        <Card>
          <p className="eyebrow">About this qualification</p>
          <p>{detail.definition.description}</p>
        </Card>
      )}

      <div className="detail-grid">
        <Card>
          <p className="eyebrow">Awarded</p>
          <strong>{formatInstant(detail.awardedAt)}</strong>
        </Card>
        <Card>
          <p className="eyebrow">Expires</p>
          <strong>{formatDate(detail.expiresAt)}</strong>
        </Card>
        {detail.status === "revoked" && (
          <Card>
            <p className="eyebrow">Revoked</p>
            <strong>{detail.revokedAt ? formatInstant(detail.revokedAt) : "—"}</strong>
          </Card>
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
    </div>
  );
}
