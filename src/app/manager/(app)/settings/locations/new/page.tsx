import { LocationForm } from "@/components/management/forms";
import { PageHeader } from "@/components/ui";
import { requireManagerPage, requireOwner } from "@/server/auth/authorization";
export default async function NewLocationPage() {
  const session = await requireManagerPage("/manager/settings/locations/new");
  await requireOwner(session);
  return (
    <div className="page-stack">
      <PageHeader
        title="Add location"
        description="Create a restaurant location and employee access code."
      />
      <LocationForm />
    </div>
  );
}
