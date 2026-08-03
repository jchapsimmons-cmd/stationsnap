import { Card, EmptyState, PageHeader, ProgressIndicator, StatusBadge } from "@/components/ui";
import { requireEmployeePage } from "@/server/auth/authorization";

export default async function EmployeeFoundationPage() {
  await requireEmployeePage("/employee");
  return (
    <div className="page-stack employee-home">
      <PageHeader
        title="Your StationSnap home"
        description="Your employee session is separate from manager access and checked by the server."
        actions={<StatusBadge tone="success">Signed in</StatusBadge>}
      />
      <div className="metric-grid">
        <Card>
          <p className="eyebrow">Station</p>
          <h2>Procedures coming next</h2>
          <p className="muted">Station details arrive in Phase 6.</p>
        </Card>
        <Card>
          <p className="eyebrow">Training</p>
          <h2>No assignments yet</h2>
          <ProgressIndicator value={0} label="Current progress" />
        </Card>
      </div>
      <EmptyState
        title="You’re all caught up"
        description="New procedures and training assignments will show here when a manager publishes them."
      />
    </div>
  );
}
