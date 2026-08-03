import { FoundationDemo } from "@/components/foundation-demo";
import { PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";

export default async function ManagerFoundationPage() {
  await requireManagerPage("/manager");
  return (
    <div className="page-stack">
      <PageHeader
        title="Manager foundation"
        description="This manager route is protected by a server-validated, expiring manager session."
        actions={<StatusBadge tone="success">Authenticated</StatusBadge>}
      />
      <FoundationDemo />
    </div>
  );
}
