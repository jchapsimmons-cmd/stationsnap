import Link from "next/link";
import { Plus } from "@phosphor-icons/react/ssr";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { employeeQuerySchema } from "@/server/management/schemas";
import { listEmployees, listLocations } from "@/server/management/service";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireManagerPage("/manager/employees");
  const params = await searchParams;
  const query = employeeQuerySchema.parse({
    search: typeof params["search"] === "string" ? params["search"] : "",
    locationId: typeof params["locationId"] === "string" ? params["locationId"] : "",
    status: typeof params["status"] === "string" ? params["status"] : "",
  });
  const [rows, locations] = await Promise.all([
    listEmployees(session, query),
    listLocations(session),
  ]);
  return (
    <div className="page-stack">
      <PageHeader
        title="People"
        description={`${rows.length} ${rows.length === 1 ? "employee" : "employees"} across your permitted locations.`}
        actions={
          <Link className="button button--primary" href="/manager/employees/new">
            <Plus size={19} aria-hidden="true" />
            Add employee
          </Link>
        }
      />
      <form className="filter-bar">
        <label>
          Search
          <input
            name="search"
            type="search"
            defaultValue={query.search}
            placeholder="Name, number, or role"
          />
        </label>
        <label>
          Location
          <select name="locationId" defaultValue={query.locationId}>
            <option value="">All permitted</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select name="status" defaultValue={query.status}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
        <button className="button button--secondary" type="submit">
          Search
        </button>
      </form>
      {rows.length === 0 ? (
        <EmptyState
          title={
            query.search || query.locationId || query.status
              ? "No matching employees"
              : "No employees yet"
          }
          description={
            query.search || query.locationId || query.status
              ? "Change the search or filters and try again."
              : "Add an employee to a permitted location."
          }
        />
      ) : (
        <div className="record-grid">
          {rows.map((row) => (
            <Link className="record-card" href={`/manager/employees/${row.id}`} key={row.id}>
              <span className="record-avatar" aria-hidden="true">
                {initials(row.displayName)}
              </span>
              <span className="record-card__body">
                <strong>{row.displayName}</strong>
                <small>
                  #{row.employeeNumber} · {row.jobRole} · {row.locationName}
                </small>
              </span>
              <StatusBadge tone={row.status === "active" ? "success" : "warning"}>
                {row.status}
              </StatusBadge>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
