import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireEmployeePage } from "@/server/auth/authorization";

export const dynamic = "force-dynamic";

export default async function EmployeeLayout({ children }: { children: ReactNode }) {
  const session = await requireEmployeePage("/employee");
  return (
    <AppShell
      variant="employee"
      userLabel={session.displayName}
      navItems={[{ href: "/employee", label: "Home" }]}
    >
      {children}
    </AppShell>
  );
}
