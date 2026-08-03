import { QrCreateForm } from "@/components/management/qr-forms";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listLocations, listStations } from "@/server/management/service";
import { sopQuerySchema } from "@/server/sops/schemas";
import { listSops } from "@/server/sops/service";

export default async function NewQrCodePage() {
  const session = await requireManagerPage("/manager/qr/new");
  const [locations, stations, sopResult] = await Promise.all([
    listLocations(session),
    listStations(session, { locationId: "", status: "active" }),
    listSops(session, sopQuerySchema.parse({ status: "published", limit: 50 })),
  ]);
  const activeLocations = locations.filter((location) => location.status === "active");

  const targets = [
    ...stations.map((station) => ({
      id: station.id,
      label: station.name,
      locationId: station.locationId,
      type: "station" as const,
    })),
    ...sopResult.items.map((sop) => ({
      id: sop.id,
      label: sop.title,
      locationId: sop.locationId,
      type: "sop" as const,
    })),
  ];

  return (
    <div className="page-stack">
      <PageHeader
        title="Create QR code"
        description="Generate a stable, revocable link to a station or published SOP."
      />
      {activeLocations.length === 0 ? (
        <EmptyState
          title="No active locations"
          description="An active permitted location is required before a QR code can be created."
        />
      ) : (
        <QrCreateForm locations={activeLocations} targets={targets} />
      )}
    </div>
  );
}
