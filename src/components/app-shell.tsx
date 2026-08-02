import Link from "next/link";
import type { ReactNode } from "react";

interface NavItem {
  href: string;
  label: string;
}

export function AppShell({
  children,
  navItems,
  variant,
}: {
  children: ReactNode;
  navItems: readonly NavItem[];
  variant: "manager" | "employee";
}) {
  return (
    <div className={`app-shell app-shell--${variant}`}>
      <header className="app-bar">
        <Link className="brand" href={variant === "manager" ? "/manager" : "/employee"}>
          Station<span>Snap</span>
        </Link>
        <span className="app-bar__context">{variant === "manager" ? "Manager" : "Team"}</span>
      </header>
      <aside className="side-nav" aria-label={`${variant} navigation`}>
        {navItems.map((item) => (
          <Link key={item.href} href={item.href}>
            {item.label}
          </Link>
        ))}
      </aside>
      <main className="app-content" id="main-content">
        {children}
      </main>
      {variant === "employee" && (
        <nav className="bottom-nav" aria-label="Employee navigation">
          {navItems.slice(0, 4).map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
