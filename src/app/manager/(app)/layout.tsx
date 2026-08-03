import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireManagerPage } from "@/server/auth/authorization";

export const dynamic = "force-dynamic";

export default async function ManagerLayout({ children }: { children: ReactNode }) {
  const session = await requireManagerPage("/manager");
  return (
    <AppShell
      variant="manager"
      userLabel={`${session.displayName} · ${session.role}`}
      navItems={[{ href: "/manager", label: "Foundation" }]}
    >
      {children}
    </AppShell>
  );
}
