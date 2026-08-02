import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";

export default function EmployeeLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell variant="employee" navItems={[{ href: "/employee", label: "Home" }]}>
      {children}
    </AppShell>
  );
}
