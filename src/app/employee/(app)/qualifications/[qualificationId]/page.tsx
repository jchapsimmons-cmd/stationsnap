import Link from "next/link";
import { QUALIFICATION_STATUS_LABELS } from "@/components/training/status";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireEmployeePage } from "@/server/auth/authorization";
import { getQualificationDetailForEmployee } from "@/server/training/qualifications";

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

export default async function EmployeeQualificationDetailPage({
  params,
}: {
  params: Promise<{ qualificationId: string }>;
}) {
  const { qualificationId } = await params;
  const session = await requireEmployeePage(`/employee/qualifications/${qualificationId}`);
  const detail = await getQualificationDetailForEmployee(session, qualificationId);

  const statusTone =
    detail.status === "revoked" ? "danger" : detail.isExpired ? "warning" : "success";

  return (
    <div className="page-stack">
      <PageHeader title={detail.definition.name} description={detail.path.title} />

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
          <p className="eyebrow">Awarded</p>
          <strong>{formatDate(detail.awardedAt) ?? "—"}</strong>
        </Card>
        <Card>
          <p className="eyebrow">Expiry</p>
          <strong>{formatDate(detail.expiresAt) ?? "Never expires"}</strong>
        </Card>
      </div>

      <Card className="form-section">
        <h2>Earned from</h2>
        {detail.supportingSessions.length === 0 ? (
          <p className="muted">No supporting sessions on record.</p>
        ) : (
          <ul className="mobile-list" aria-label="Supporting sessions">
            {detail.supportingSessions.map((row) => (
              <li key={row.sessionId}>
                <div>
                  <Link href={`/employee/sops/${row.sopId}`}>
                    {row.sopTitle} · v{row.sopVersionNumber}
                  </Link>
                  <span>
                    {row.completedAt ? `Completed ${formatInstant(row.completedAt)}` : "—"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {detail.status === "revoked" && (
        <Card className="form-section">
          <h2>Revoked</h2>
          <p>{detail.revokedAt ? formatInstant(detail.revokedAt) : "—"}</p>
          {detail.revokedNote && <p>{detail.revokedNote}</p>}
        </Card>
      )}
    </div>
  );
}
