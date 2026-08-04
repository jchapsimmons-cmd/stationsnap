import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireManagerPage } from "@/server/auth/authorization";

export const dynamic = "force-dynamic";

export default async function ManagerLayout({ children }: { children: ReactNode }) {
  const session = await requireManagerPage("/manager");
  const navItems = [
    { href: "/manager", label: "Overview" },
    { href: "/manager/sops", label: "SOPs" },
    { href: "/manager/training/assignments", label: "Training" },
    { href: "/manager/training/approvals", label: "Approvals" },
    { href: "/manager/settings/locations", label: "Locations" },
    { href: "/manager/settings/stations", label: "Stations" },
    { href: "/manager/qr", label: "QR codes" },
    { href: "/manager/employees", label: "Employees" },
    { href: "/manager/settings/organization", label: "Organization" },
    ...(session.role === "owner" ? [{ href: "/manager/managers", label: "Manager access" }] : []),
  ];
  return (
    <AppShell
      variant="manager"
      userLabel={`${session.displayName} · ${session.role}`}
      navItems={navItems}
    >
      {children}
    </AppShell>
  );
}
