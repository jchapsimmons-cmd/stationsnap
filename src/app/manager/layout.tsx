import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";

export default function ManagerLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell variant="manager" navItems={[{ href: "/manager", label: "Foundation" }]}>
      {children}
    </AppShell>
  );
}
