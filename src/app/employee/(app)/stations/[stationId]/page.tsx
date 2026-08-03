import { EmployeeSopLibrary } from "@/components/sops/employee-sop-library";
import { requireEmployeePage } from "@/server/auth/authorization";
import { getStationForEmployee } from "@/server/management/service";

export default async function EmployeeStationLibraryPage({
  params,
  searchParams,
}: {
  params: Promise<{ stationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { stationId } = await params;
  const basePath = `/employee/stations/${stationId}`;
  const session = await requireEmployeePage(basePath);
  const station = await getStationForEmployee(session, stationId);

  return (
    <EmployeeSopLibrary
      basePath={basePath}
      title={station.name}
      description={station.description || "Published procedures for this station."}
      stationId={stationId}
      emptyTitle="Nothing published for this station yet"
      emptyDescription="Your manager hasn't published any procedures for this station yet."
      searchParams={searchParams}
    />
  );
}
