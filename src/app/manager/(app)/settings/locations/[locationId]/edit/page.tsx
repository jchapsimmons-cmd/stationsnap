import { LocationForm } from "@/components/management/forms";
import { PageHeader } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getLocation } from "@/server/management/service";
export default async function EditLocationPage({
  params,
}: {
  params: Promise<{ locationId: string }>;
}) {
  const { locationId } = await params;
  const session = await requireManagerPage(`/manager/settings/locations/${locationId}/edit`);
  const location = await getLocation(session, locationId);
  return (
    <div className="page-stack">
      <PageHeader
        title={`Edit ${location.name}`}
        description="Disabled locations cannot be used for employee login."
      />
      <LocationForm location={location} />
    </div>
  );
}
