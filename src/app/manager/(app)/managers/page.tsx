import Link from "next/link";
import { UserGear } from "@phosphor-icons/react/ssr";
import { PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listManagers } from "@/server/management/service";
export default async function ManagersPage() {
  const session = await requireManagerPage("/manager/managers");
  const rows = await listManagers(session);
  return (
    <div className="page-stack">
      <PageHeader
        title="Manager access"
        description="Owners have organization-wide access. Managers must be assigned to locations."
      />
      <div className="record-grid">
        {rows.map((row) => (
          <Link
            className="record-card"
            href={`/manager/managers/${row.membershipId}`}
            key={row.membershipId}
          >
            <span className="record-avatar" aria-hidden="true">
              <UserGear size={20} />
            </span>
            <span className="record-card__body">
              <strong>{row.displayName}</strong>
              <small>
                {row.email} · {row.role}
              </small>
            </span>
            <StatusBadge tone={row.status === "active" ? "success" : "warning"}>
              {row.status}
            </StatusBadge>
          </Link>
        ))}
      </div>
    </div>
  );
}
