import Link from "next/link";
import type { ReactNode } from "react";
import { LogoutButton } from "@/components/auth/logout-button";

interface NavItem {
  href: string;
  label: string;
}

export function AppShell({
  children,
  navItems,
  userLabel,
  variant,
}: {
  children: ReactNode;
  navItems: readonly NavItem[];
  userLabel: string;
  variant: "manager" | "employee";
}) {
  return (
    <div className={`app-shell app-shell--${variant}`}>
      <header className="app-bar">
        <Link className="brand" href={variant === "manager" ? "/manager" : "/employee"}>
          Station<span>Snap</span>
        </Link>
        <div className="app-bar__account">
          <span className="app-bar__context">{userLabel}</span>
          <LogoutButton kind={variant} />
        </div>
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
