import Link from "next/link";
import { EmptyState, Pagination, PageHeader, StatusBadge } from "@/components/ui";
import { MarkNotificationReadButton } from "@/components/notifications/mark-read-button";
import { requireEmployeePage } from "@/server/auth/authorization";
import { notificationQuerySchema } from "@/server/notifications/schemas";
import { listNotificationsForEmployee } from "@/server/notifications/service";

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

function formatInstant(value: Date): string {
  return value.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function EmployeeNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireEmployeePage("/employee/notifications");
  const params = await searchParams;
  const raw: Record<string, string> = {
    unreadOnly: typeof params["unreadOnly"] === "string" ? params["unreadOnly"] : "",
    type: "",
    page: typeof params["page"] === "string" ? params["page"] : "1",
  };
  const query = notificationQuerySchema.parse(raw);
  const { items, total } = await listNotificationsForEmployee(session, query);

  return (
    <div className="page-stack">
      <PageHeader
        title="Notifications"
        description="New training, due dates, qualification changes, and approval decisions."
      />
      <form className="filter-bar" action="/employee/notifications">
        <label>
          Show
          <select name="unreadOnly" defaultValue={query.unreadOnly}>
            <option value="">All</option>
            <option value="1">Unread only</option>
          </select>
        </label>
        <button className="button button--secondary" type="submit">
          Filter
        </button>
      </form>
      {items.length === 0 ? (
        <EmptyState
          title="You're all caught up"
          description="New training, due dates, and approval decisions will appear here."
        />
      ) : (
        <div className="record-grid">
          {items.map((item) => (
            <div className="record-card" key={item.id}>
              <span className="record-card__body">
                <strong>{item.title}</strong>
                {item.body && <small>{item.body}</small>}
                <small>{formatInstant(item.createdAt)}</small>
              </span>
              <span className="record-card__body">
                {!item.readAt && <StatusBadge tone="info">Unread</StatusBadge>}
                {item.internalPath && <Link href={item.internalPath}>View</Link>}
                {!item.readAt && (
                  <MarkNotificationReadButton
                    readHref={`/api/employee/notifications/${item.id}/read`}
                  />
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      <Pagination
        page={query.page}
        pageSize={query.pageSize}
        total={total}
        buildHref={(page) =>
          `/employee/notifications${buildQueryString(raw, { page: String(page) })}`
        }
      />
    </div>
  );
}
