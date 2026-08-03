import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";

export function AuthShell({
  eyebrow,
  title,
  description,
  children,
  alternate,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  alternate?: { href: string; label: string };
}) {
  return (
    <main className="auth-page" id="main-content">
      <section className="auth-card">
        <div className="auth-card__top">
          <Link className="brand auth-card__brand" href="/">
            Station<span>Snap</span>
          </Link>
          <ThemeToggle />
        </div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="auth-card__description">{description}</p>
        {children}
        {alternate && (
          <Link className="auth-card__alternate" href={alternate.href}>
            {alternate.label}
          </Link>
        )}
      </section>
      <aside className="auth-page__aside" aria-label="StationSnap security">
        <p className="eyebrow">Secure by design</p>
        <h2>Access follows the restaurant.</h2>
        <p>
          Every manager and employee session is checked against its organization, location, role,
          and account status on the server.
        </p>
      </aside>
    </main>
  );
}
