import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";

const REPORTS = [
  {
    href: "/manager/reports/training",
    title: "Training progress",
    description: "Assignment status and failures across employees and SOPs.",
  },
  {
    href: "/manager/reports/qualifications",
    title: "Qualifications",
    description: "Qualified, in-training, missing, and expiring status by employee.",
  },
  {
    href: "/manager/reports/checklists",
    title: "Checklist completion",
    description: "Run status and history by checklist and location.",
  },
  {
    href: "/manager/reports/approvals",
    title: "Approval decisions",
    description: "Training and checklist approval history, newest first.",
  },
  {
    href: "/manager/reports/sop-versions",
    title: "SOP version history",
    description: "Every published, draft, and archived version across your SOPs.",
  },
] as const;

export default async function ManagerReportsIndexPage() {
  await requireManagerPage("/manager/reports");

  return (
    <div className="page-stack">
      <PageHeader
        title="Reports"
        description="Filtered, paginated views over your permitted locations' records."
      />
      <div className="record-grid">
        {REPORTS.map((report) => (
          <Link className="record-card" href={report.href} key={report.href}>
            <span className="record-card__body">
              <strong>{report.title}</strong>
              <small>{report.description}</small>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
