import { OrganizationForm } from "@/components/management/forms";
import { PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getOrganization } from "@/server/management/service";

export default async function OrganizationSettingsPage() {
  const session = await requireManagerPage("/manager/settings/organization");
  const organization = await getOrganization(session);
  return (
    <div className="page-stack">
      <PageHeader
        title="Organization settings"
        description={
          session.role === "owner"
            ? "Update organization-wide identity and defaults."
            : "Organization settings are read-only for managers."
        }
        actions={
          <StatusBadge tone={organization.status === "active" ? "success" : "warning"}>
            {organization.status}
          </StatusBadge>
        }
      />
      <OrganizationForm organization={organization} canEdit={session.role === "owner"} />
    </div>
  );
}
