import Link from "next/link";
import {
  QUALIFICATION_CLASSIFICATION_LABELS,
  QUALIFICATION_CLASSIFICATION_TONE,
} from "@/components/training/status";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireEmployeePage } from "@/server/auth/authorization";
import {
  listQualificationsForEmployee,
  type EmployeeQualificationSections,
  type EmployeeQualificationSummary,
} from "@/server/training/qualifications";

function formatDate(value: Date | null): string {
  if (!value) return "Never expires";
  return value.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function QualificationSection({
  title,
  items,
  linkable,
}: {
  title: string;
  items: readonly EmployeeQualificationSummary[];
  linkable: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <section className="page-stack">
      <h2>
        {title} ({items.length})
      </h2>
      <div className="record-grid">
        {items.map((item) => {
          const body = (
            <span className="record-card__body">
              <strong>{item.definitionName}</strong>
              <small>{item.pathTitle}</small>
              {item.awardedAt && <small>{formatDate(item.expiresAt)}</small>}
            </span>
          );
          const badges = (
            <span className="action-row">
              <StatusBadge tone={QUALIFICATION_CLASSIFICATION_TONE[item.status] ?? "neutral"}>
                {QUALIFICATION_CLASSIFICATION_LABELS[item.status] ?? item.status}
              </StatusBadge>
              {item.isExpiringSoon && <StatusBadge tone="warning">Expiring soon</StatusBadge>}
            </span>
          );
          if (linkable && item.qualificationId) {
            return (
              <Link
                className="record-card"
                href={`/employee/qualifications/${item.qualificationId}`}
                key={item.definitionId}
              >
                {body}
                {badges}
              </Link>
            );
          }
          return (
            <div className="record-card" key={item.definitionId}>
              {body}
              {badges}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function isEmpty(sections: EmployeeQualificationSections): boolean {
  return (
    sections.earned.length === 0 &&
    sections.expiring.length === 0 &&
    sections.expired.length === 0 &&
    sections.inProgress.length === 0 &&
    sections.missing.length === 0
  );
}

export default async function EmployeeQualificationsPage() {
  const session = await requireEmployeePage("/employee/qualifications");
  const sections = await listQualificationsForEmployee(session);

  return (
    <div className="page-stack">
      <PageHeader
        title="Qualifications"
        description="What you're qualified for at this location."
      />
      {isEmpty(sections) ? (
        <EmptyState
          title="No qualifications yet"
          description="Qualifications appear here once your manager sets up a training path."
        />
      ) : (
        <>
          <QualificationSection title="Expiring soon" items={sections.expiring} linkable />
          <QualificationSection title="Earned" items={sections.earned} linkable />
          <QualificationSection title="In progress" items={sections.inProgress} linkable={false} />
          <QualificationSection title="Expired" items={sections.expired} linkable />
          <QualificationSection title="Missing" items={sections.missing} linkable={false} />
        </>
      )}
    </div>
  );
}
