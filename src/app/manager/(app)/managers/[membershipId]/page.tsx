import { ManagerAssignmentsForm } from "@/components/management/forms";
import { PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getManagerAssignments, listLocations } from "@/server/management/service";
export default async function ManagerDetailPage({
  params,
}: {
  params: Promise<{ membershipId: string }>;
}) {
  const { membershipId } = await params;
  const session = await requireManagerPage(`/manager/managers/${membershipId}`);
  const [manager, locations] = await Promise.all([
    getManagerAssignments(session, membershipId),
    listLocations(session),
  ]);
  return (
    <div className="page-stack">
      <PageHeader
        title={manager.displayName}
        description={`${manager.email} · ${manager.role}`}
        actions={
          <StatusBadge tone={manager.status === "active" ? "success" : "warning"}>
            {manager.status}
          </StatusBadge>
        }
      />
      {manager.role === "owner" ? (
        <p className="form-status">Owners automatically have access to every location.</p>
      ) : (
        <ManagerAssignmentsForm
          membershipId={manager.membershipId}
          assignedLocationIds={manager.locationIds}
          locations={locations}
        />
      )}
    </div>
  );
}
