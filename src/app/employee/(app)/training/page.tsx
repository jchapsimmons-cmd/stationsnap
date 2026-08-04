import Link from "next/link";
import { ASSIGNMENT_STATUS_TONE } from "@/components/training/status";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireEmployeePage } from "@/server/auth/authorization";
import {
  listAssignmentsForEmployee,
  type EmployeeAssignmentSections,
  type EmployeeAssignmentSummary,
} from "@/server/training/service";

function formatDueDate(dueAt: Date | null, dueTimezone: string | null): string | null {
  if (!dueAt) return null;
  return dueAt.toLocaleDateString("en-US", {
    timeZone: dueTimezone ?? "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function AssignmentSection({
  title,
  items,
  badgeTone,
}: {
  title: string;
  items: readonly EmployeeAssignmentSummary[];
  badgeTone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  if (items.length === 0) return null;
  return (
    <section className="page-stack">
      <h2>
        {title} ({items.length})
      </h2>
      <div className="record-grid">
        {items.map((item) => {
          const dueLabel = formatDueDate(item.dueAt, item.dueTimezone);
          return (
            <Link className="record-card" href={`/employee/training/${item.id}`} key={item.id}>
              <span className="record-card__body">
                <strong>{item.sopTitle}</strong>
                {dueLabel && <small>Due {dueLabel}</small>}
              </span>
              <StatusBadge tone={badgeTone ?? ASSIGNMENT_STATUS_TONE[item.status] ?? "neutral"}>
                {item.status.replace("_", " ")}
              </StatusBadge>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function isEmpty(sections: EmployeeAssignmentSections): boolean {
  return (
    sections.active.length === 0 &&
    sections.overdue.length === 0 &&
    sections.due.length === 0 &&
    sections.assigned.length === 0 &&
    sections.completed.length === 0 &&
    sections.failed.length === 0
  );
}

export default async function EmployeeTrainingPage() {
  const session = await requireEmployeePage("/employee/training");
  const sections = await listAssignmentsForEmployee(session);

  return (
    <div className="page-stack">
      <PageHeader title="Training" description="Your assigned, due, and completed training." />
      {isEmpty(sections) ? (
        <EmptyState
          title="No training assigned"
          description="Training your manager assigns to you will show up here."
        />
      ) : (
        <>
          <AssignmentSection title="In progress" items={sections.active} badgeTone="warning" />
          <AssignmentSection title="Overdue" items={sections.overdue} badgeTone="danger" />
          <AssignmentSection title="Due" items={sections.due} badgeTone="info" />
          <AssignmentSection title="Assigned" items={sections.assigned} badgeTone="neutral" />
          <AssignmentSection title="Completed" items={sections.completed} badgeTone="success" />
          <AssignmentSection title="Failed" items={sections.failed} badgeTone="danger" />
        </>
      )}
    </div>
  );
}
