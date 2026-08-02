import type { ReactNode } from "react";
import clsx from "clsx";

export interface DataColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  caption,
}: {
  columns: readonly DataColumn<T>[];
  rows: readonly T[];
  getRowKey: (row: T) => string;
  caption: string;
}) {
  return (
    <div className="table-scroll" tabIndex={0} aria-label={`${caption}, horizontally scrollable`}>
      <table className="data-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowKey(row)}>
              {columns.map((column) => (
                <td key={column.key}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MobileList({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <ul className={clsx("mobile-list", className)} aria-label={label}>
      {children}
    </ul>
  );
}

export interface TabItem {
  href: string;
  label: string;
  active?: boolean;
}

export function Tabs({ items, label }: { items: readonly TabItem[]; label: string }) {
  return (
    <nav className="tabs" aria-label={label}>
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={clsx(item.active && "tabs__item--active")}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
