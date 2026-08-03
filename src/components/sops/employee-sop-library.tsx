import Link from "next/link";
import { categoryLabel } from "@/components/sops/options";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireEmployeePage } from "@/server/auth/authorization";
import { employeeSopQuerySchema } from "@/server/sops/schemas";
import { listPublishedSopsForEmployee } from "@/server/sops/service";

function buildQueryString(
  params: Record<string, string>,
  overrides: Record<string, string>,
): string {
  const merged = { ...params, ...overrides };
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export async function EmployeeSopLibrary({
  basePath,
  title,
  description,
  category,
  stationId,
  emptyTitle,
  emptyDescription,
  searchParams,
}: {
  basePath: string;
  title: string;
  description: string;
  category?: string;
  stationId?: string;
  emptyTitle: string;
  emptyDescription: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireEmployeePage(basePath);
  const params = await searchParams;
  const raw = {
    search: typeof params["search"] === "string" ? params["search"] : "",
    category: category ?? "",
    stationId: stationId ?? "",
    cursor: typeof params["cursor"] === "string" ? params["cursor"] : "",
  };
  const query = employeeSopQuerySchema.parse(raw);
  const { items, nextCursor } = await listPublishedSopsForEmployee(session, query);

  return (
    <div className="page-stack">
      <PageHeader title={title} description={description} />
      <form className="filter-bar" action={basePath}>
        <label>
          Search
          <input
            name="search"
            type="search"
            defaultValue={query.search}
            placeholder="Search procedures"
          />
        </label>
        <button className="button button--secondary" type="submit">
          Search
        </button>
      </form>
      {items.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className="record-grid">
          {items.map((item) => (
            <Link className="record-card" href={`/employee/sops/${item.id}`} key={item.id}>
              <span className="record-card__body">
                <strong>{item.title}</strong>
                <small>
                  {categoryLabel(item.category)}
                  {item.stationName ? ` · ${item.stationName}` : ""}
                  {item.estimatedMinutes ? ` · ${item.estimatedMinutes} min` : ""}
                </small>
              </span>
            </Link>
          ))}
        </div>
      )}
      {nextCursor && (
        <Link
          className="button button--secondary"
          href={`${basePath}${buildQueryString(raw, { cursor: nextCursor })}`}
        >
          Load more
        </Link>
      )}
    </div>
  );
}
