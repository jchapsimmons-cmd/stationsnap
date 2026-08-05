import Link from "next/link";
import { EmptyState, Pagination, PageHeader, StatusBadge } from "@/components/ui";
import { MarkNotificationReadButton } from "@/components/notifications/mark-read-button";
import { requireManagerPage } from "@/server/auth/authorization";
import { notificationQuerySchema } from "@/server/notifications/schemas";
import { listNotificationsForManager } from "@/server/notifications/service";
import { NOTIFICATION_TYPE_LABELS, notificationTypeValues } from "@/server/notifications/labels";

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

export default async function ManagerNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireManagerPage("/manager/notifications");
  const params = await searchParams;
  const raw: Record<string, string> = {
    unreadOnly: typeof params["unreadOnly"] === "string" ? params["unreadOnly"] : "",
    type: typeof params["type"] === "string" ? params["type"] : "",
    page: typeof params["page"] === "string" ? params["page"] : "1",
  };
  const query = notificationQuerySchema.parse(raw);
  const { items, total } = await listNotificationsForManager(session, query);

  return (
    <div className="page-stack">
      <PageHeader
        title="Notifications"
        description="Training approvals and checklist runs waiting on you, and every notification you've received."
      />
      <form className="filter-bar" action="/manager/notifications">
        <label>
          Show
          <select name="unreadOnly" defaultValue={query.unreadOnly}>
            <option value="">All</option>
            <option value="1">Unread only</option>
          </select>
        </label>
        <label>
          Type
          <select name="type" defaultValue={query.type}>
            <option value="">All types</option>
            {notificationTypeValues.map((type) => (
              <option key={type} value={type}>
                {NOTIFICATION_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        <button className="button button--secondary" type="submit">
          Filter
        </button>
      </form>
      {items.length === 0 ? (
        <EmptyState
          title="You're all caught up"
          description="Training approvals, checklist runs awaiting review, and other notifications will appear here."
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
                    readHref={`/api/management/notifications/${item.id}/read`}
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
          `/manager/notifications${buildQueryString(raw, { page: String(page) })}`
        }
      />
    </div>
  );
}
