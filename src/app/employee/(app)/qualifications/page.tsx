import Link from "next/link";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireEmployeePage } from "@/server/auth/authorization";
import {
  listQualificationsForEmployee,
  type EmployeeQualificationSections,
  type EmployeeQualificationSummary,
} from "@/server/training/qualifications";

function formatDate(value: Date | null): string | null {
  if (!value) return null;
  return value.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function QualificationSection({
  title,
  items,
  badgeTone,
  detail,
}: {
  title: string;
  items: readonly EmployeeQualificationSummary[];
  badgeTone: "neutral" | "success" | "warning" | "danger" | "info";
  detail: (item: EmployeeQualificationSummary) => string | null;
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
              {detail(item) && <small>{detail(item)}</small>}
            </span>
          );
          return item.qualificationId ? (
            <Link
              className="record-card"
              href={`/employee/qualifications/${item.qualificationId}`}
              key={item.definitionId}
            >
              {body}
              <StatusBadge tone={badgeTone}>{title}</StatusBadge>
            </Link>
          ) : (
            <div className="record-card" key={item.definitionId}>
              {body}
              <StatusBadge tone={badgeTone}>{title}</StatusBadge>
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
        description="Earned, expiring, and in-progress qualifications for your location."
      />
      {isEmpty(sections) ? (
        <EmptyState
          title="No qualifications yet"
          description="Qualifications are earned automatically as you complete a training path's required procedures."
        />
      ) : (
        <>
          <QualificationSection
            title="Expiring soon"
            items={sections.expiring}
            badgeTone="warning"
            detail={(item) => {
              const expires = formatDate(item.expiresAt);
              return expires ? `Expires ${expires}` : null;
            }}
          />
          <QualificationSection
            title="Expired"
            items={sections.expired}
            badgeTone="danger"
            detail={(item) => {
              const expired = formatDate(item.expiresAt);
              return expired ? `Expired ${expired}` : null;
            }}
          />
          <QualificationSection
            title="Earned"
            items={sections.earned}
            badgeTone="success"
            detail={(item) => {
              const awarded = formatDate(item.awardedAt);
              return awarded ? `Awarded ${awarded}` : null;
            }}
          />
          <QualificationSection
            title="In progress"
            items={sections.inProgress}
            badgeTone="info"
            detail={() => null}
          />
          <QualificationSection
            title="Missing"
            items={sections.missing}
            badgeTone="neutral"
            detail={() => null}
          />
        </>
      )}
    </div>
  );
}
