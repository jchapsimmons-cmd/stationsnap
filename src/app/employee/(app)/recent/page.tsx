import Link from "next/link";
import { categoryLabel } from "@/components/sops/options";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireEmployeePage } from "@/server/auth/authorization";
import { listRecentSopsForEmployee } from "@/server/sops/service";

export default async function RecentSopsPage() {
  const session = await requireEmployeePage("/employee/recent");
  const items = await listRecentSopsForEmployee(session);

  return (
    <div className="page-stack">
      <PageHeader title="Recently viewed" description="Procedures you've opened recently." />
      {items.length === 0 ? (
        <EmptyState
          title="Nothing viewed yet"
          description="Procedures you open will show up here for quick access."
        />
      ) : (
        <div className="record-grid">
          {items.map((item) => (
            <Link className="record-card" href={`/employee/sops/${item.id}`} key={item.id}>
              <span className="record-card__body">
                <strong>{item.title}</strong>
                <small>
                  {categoryLabel(item.category)}
                  {item.stationName ? ` · ${item.stationName}` : ""}
                </small>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
