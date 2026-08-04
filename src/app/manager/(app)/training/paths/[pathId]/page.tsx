import { TrainingPathForm } from "@/components/training/path-form";
import { Card, PageHeader } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listLocations, listStations } from "@/server/management/service";
import { getPathDetail, listPublishedSopsForPathBuilder } from "@/server/training/qualifications";

export default async function ManagerTrainingPathDetailPage({
  params,
}: {
  params: Promise<{ pathId: string }>;
}) {
  const { pathId } = await params;
  const session = await requireManagerPage(`/manager/training/paths/${pathId}`);
  const [path, allLocations, stations, sops] = await Promise.all([
    getPathDetail(session, pathId),
    listLocations(session),
    listStations(session, { locationId: "", status: "active" }),
    listPublishedSopsForPathBuilder(session),
  ]);
  const locations = allLocations.filter((location) => location.status === "active");
  const { qualificationSummary } = path;

  return (
    <div className="page-stack">
      <PageHeader
        title={path.title}
        description={`${path.definition.name} · ${path.locationName}${path.stationName ? ` · ${path.stationName}` : ""}`}
      />

      <Card className="form-section">
        <h2>Qualification summary</h2>
        <div className="detail-grid">
          <div>
            <p className="eyebrow">Active</p>
            <strong>{qualificationSummary.active}</strong>
          </div>
          <div>
            <p className="eyebrow">Revoked</p>
            <strong>{qualificationSummary.revoked}</strong>
          </div>
          <div>
            <p className="eyebrow">Expired</p>
            <strong>{qualificationSummary.expired}</strong>
          </div>
        </div>
      </Card>

      <TrainingPathForm
        locations={locations}
        stations={stations}
        sops={sops}
        path={{
          id: path.id,
          title: path.title,
          description: path.description,
          locationId: path.locationId,
          locationName: path.locationName,
          stationId: path.stationId,
          stationName: path.stationName,
          enforceOrder: path.enforceOrder,
          status: path.status,
          definition: {
            name: path.definition.name,
            description: path.definition.description,
            defaultValidityDays: path.definition.defaultValidityDays,
          },
          items: path.items.map((item) => ({
            sopId: item.sopId,
            sopTitle: item.sopTitle,
            isRequired: item.isRequired,
            versionPolicy: item.versionPolicy,
          })),
        }}
      />
    </div>
  );
}
