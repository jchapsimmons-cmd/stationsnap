import Link from "next/link";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getStation } from "@/server/management/service";
export default async function StationDetailPage({
  params,
}: {
  params: Promise<{ stationId: string }>;
}) {
  const { stationId } = await params;
  const session = await requireManagerPage(`/manager/settings/stations/${stationId}`);
  const station = await getStation(session, stationId);
  return (
    <div className="page-stack">
      <PageHeader
        title={station.name}
        description={`${station.locationName} · display order ${station.displayOrder}`}
        actions={
          <Link
            className="button button--secondary"
            href={`/manager/settings/stations/${station.id}/edit`}
          >
            Edit station
          </Link>
        }
      />
      <Card className="detail-card">
        <StatusBadge tone={station.status === "active" ? "success" : "warning"}>
          {station.status === "active" ? "active" : "archived"}
        </StatusBadge>
        <h2>Description</h2>
        <p>{station.description || "No description has been added."}</p>
        {station.imageUrl && (
          <p>
            <a href={station.imageUrl} target="_blank" rel="noreferrer">
              Open station image
            </a>
          </p>
        )}
      </Card>
    </div>
  );
}
