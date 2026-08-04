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
      navItems={[
        { href: "/employee", label: "Home" },
        { href: "/employee/stations", label: "Stations" },
        { href: "/employee/training", label: "Training" },
        { href: "/employee/qualifications", label: "Qualifications" },
        { href: "/employee/recent", label: "Recent" },
        { href: "/employee/recipes", label: "Recipes" },
        { href: "/employee/cleaning", label: "Cleaning" },
        { href: "/employee/opening", label: "Opening" },
        { href: "/employee/closing", label: "Closing" },
      ]}
    >
      {children}
    </AppShell>
  );
}
