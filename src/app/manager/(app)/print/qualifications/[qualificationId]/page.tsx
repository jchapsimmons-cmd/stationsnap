import { QUALIFICATION_STATUS_LABELS } from "@/components/training/status";
import { PrintActions } from "@/components/print/print-actions";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getQualificationDetail } from "@/server/training/qualifications";

function formatDate(value: Date | null): string {
  if (!value) return "—";
  return value.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default async function QualificationPrintPage({
  params,
}: {
  params: Promise<{ qualificationId: string }>;
}) {
  const { qualificationId } = await params;
  const session = await requireManagerPage(`/manager/print/qualifications/${qualificationId}`);
  const detail = await getQualificationDetail(session, qualificationId);
  const statusTone =
    detail.status === "revoked" ? "danger" : detail.isExpired ? "warning" : "success";

  return (
    <div className="page-stack print-sheet">
      <PageHeader
        title={detail.definition.name}
        description={`${detail.employeeName} (#${detail.employeeNumber}) · ${detail.locationName}`}
        actions={<PrintActions pdfHref={`/manager/print/qualifications/${qualificationId}/pdf`} />}
      />
      <Card className="print-sheet__section">
        <StatusBadge tone={statusTone}>
          {detail.status === "revoked"
            ? QUALIFICATION_STATUS_LABELS["revoked"]
            : detail.isExpired
              ? "Expired"
              : QUALIFICATION_STATUS_LABELS["active"]}
        </StatusBadge>
        {detail.definition.description && <p>{detail.definition.description}</p>}
        <p className="muted">Path: {detail.path.title}</p>
        <p className="muted">Awarded: {formatDate(detail.awardedAt)}</p>
        <p className="muted">Expires: {formatDate(detail.expiresAt)}</p>
        {detail.status === "revoked" && (
          <p className="muted">
            Revoked {formatDate(detail.revokedAt)}
            {detail.revokedNote ? ` — ${detail.revokedNote}` : ""}
          </p>
        )}
      </Card>

      <Card className="print-sheet__section">
        <h2>Supporting completions</h2>
        {detail.supportingSessions.length === 0 ? (
          <p className="muted">No supporting sessions on record.</p>
        ) : (
          <ul>
            {detail.supportingSessions.map((row) => (
              <li key={row.sessionId}>
                {row.sopTitle} · v{row.sopVersionNumber}
                {row.completedAt ? ` · ${formatDate(row.completedAt)}` : ""}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
