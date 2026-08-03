import Link from "next/link";
import type { ReactNode } from "react";
import {
  Buildings,
  CookingPot,
  Gear,
  House,
  MapPin,
  UserGear,
  Users,
} from "@phosphor-icons/react/ssr";
import { LogoutButton } from "@/components/auth/logout-button";
import { ThemeToggle } from "@/components/theme-toggle";

interface NavItem {
  href: string;
  label: string;
}

function NavIcon({ href }: { href: string }) {
  const props = { size: 19, weight: "regular" as const, "aria-hidden": true };
  if (href === "/manager" || href === "/employee") return <House {...props} />;
  if (href.includes("locations")) return <MapPin {...props} />;
  if (href.includes("stations")) return <CookingPot {...props} />;
  if (href.includes("employees")) return <Users {...props} />;
  if (href.includes("managers")) return <UserGear {...props} />;
  if (href.includes("organization")) return <Buildings {...props} />;
  return <Gear {...props} />;
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
          <ThemeToggle />
          <LogoutButton kind={variant} />
        </div>
      </header>
      <aside className="side-nav" aria-label={`${variant} navigation`}>
        {navItems.map((item) => (
          <Link key={item.href} href={item.href}>
            <NavIcon href={item.href} />
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
              <NavIcon href={item.href} />
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
