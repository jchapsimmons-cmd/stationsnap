import { QrRevokeButton, QrRotateButton } from "@/components/management/qr-forms";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getQrCode } from "@/server/qr/service";

export default async function QrCodeDetailPage({
  params,
}: {
  params: Promise<{ qrCodeId: string }>;
}) {
  const { qrCodeId } = await params;
  const session = await requireManagerPage(`/manager/qr/${qrCodeId}`);
  const qr = await getQrCode(session, qrCodeId);

  return (
    <div className="page-stack">
      <PageHeader
        title={qr.label || qr.targetName || "QR code"}
        description={`${qr.targetType === "station" ? "Station" : "SOP"} · ${qr.locationName}`}
        actions={
          <StatusBadge tone={qr.status === "active" ? "success" : "warning"}>
            {qr.status}
          </StatusBadge>
        }
      />
      <div className="detail-grid">
        <Card>
          <p className="eyebrow">Points to</p>
          <strong>{qr.targetName ?? "Unavailable"}</strong>
        </Card>
        <Card>
          <p className="eyebrow">Destination</p>
          <strong>{qr.destinationPath}</strong>
        </Card>
        <Card>
          <p className="eyebrow">Created</p>
          <strong>{qr.createdAt.toLocaleString()}</strong>
        </Card>
        {qr.revokedAt && (
          <Card>
            <p className="eyebrow">Revoked</p>
            <strong>{qr.revokedAt.toLocaleString()}</strong>
          </Card>
        )}
      </div>
      {qr.status === "active" && (
        <Card>
          <h2>Reissue and print</h2>
          <p>
            The scannable link is only shown once. If the printed poster for this QR code is lost or
            damaged, reissue a new one — the old poster stops working immediately.
          </p>
          <QrRotateButton qrCodeId={qr.id} label={qr.label || qr.targetName || "QR code"} />
        </Card>
      )}
      <Card>
        <h2>Recent scans</h2>
        {qr.scanEvents.length === 0 ? (
          <p className="muted">No scans yet.</p>
        ) : (
          <ul>
            {qr.scanEvents.map((event) => (
              <li key={event.id}>
                {event.createdAt.toLocaleString()} · {event.result}
                {event.employeeId ? " · signed in" : ""}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {qr.status === "active" && (
        <Card>
          <h2>Revoke</h2>
          <p>
            Revoking permanently disables this QR code. Create a new one if you need a replacement.
          </p>
          <QrRevokeButton qrCodeId={qr.id} />
        </Card>
      )}
    </div>
  );
}
