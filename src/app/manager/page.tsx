import { FoundationDemo } from "@/components/foundation-demo";
import { PageHeader, StatusBadge } from "@/components/ui";

export default function ManagerFoundationPage() {
  return (
    <div className="page-stack">
      <PageHeader
        title="Manager foundation"
        description="Reusable controls and application states for future StationSnap manager workflows."
        actions={<StatusBadge tone="success">Foundation ready</StatusBadge>}
      />
      <FoundationDemo />
    </div>
  );
}
