import Link from "next/link";
import { Plus } from "@phosphor-icons/react/ssr";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listQrCodes } from "@/server/qr/service";

export default async function QrRegistryPage() {
  const session = await requireManagerPage("/manager/qr");
  const qrCodes = await listQrCodes(session, { locationId: "", status: "" });

  return (
    <div className="page-stack">
      <PageHeader
        title="QR codes"
        description="Stable, revocable links that take employees straight to a station or SOP."
        actions={
          <Link className="button button--primary" href="/manager/qr/new">
            <Plus size={19} aria-hidden="true" />
            New QR code
          </Link>
        }
      />
      {qrCodes.length === 0 ? (
        <EmptyState
          title="No QR codes yet"
          description="Create a QR code for a station or published SOP so employees can scan straight into it."
        />
      ) : (
        <div className="record-grid">
          {qrCodes.map((qr) => (
            <Link className="record-card" href={`/manager/qr/${qr.id}`} key={qr.id}>
              <span className="record-card__body">
                <strong>{qr.label || qr.targetName || "QR code"}</strong>
                <small>
                  {qr.targetType === "station" ? "Station" : "SOP"} · {qr.locationName}
                </small>
              </span>
              <StatusBadge tone={qr.status === "active" ? "success" : "warning"}>
                {qr.status}
              </StatusBadge>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
