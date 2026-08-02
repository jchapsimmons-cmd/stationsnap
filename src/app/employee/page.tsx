import { Card, EmptyState, PageHeader, ProgressIndicator, StatusBadge } from "@/components/ui";

export default function EmployeeFoundationPage() {
  return (
    <div className="page-stack employee-home">
      <PageHeader
        title="Good shift, Maya"
        description="Your station information and training will appear here."
        actions={<StatusBadge tone="info">Downtown</StatusBadge>}
      />
      <div className="metric-grid">
        <Card>
          <p className="eyebrow">Today</p>
          <h2>Grill station</h2>
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
