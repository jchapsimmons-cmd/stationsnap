import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireEmployeePage } from "@/server/auth/authorization";
import { reconcileTimeBasedNotificationsBestEffort } from "@/server/notifications/service";

export const dynamic = "force-dynamic";

export default async function EmployeeLayout({ children }: { children: ReactNode }) {
  const session = await requireEmployeePage("/employee");
  // Best-effort, cheap after the first page view of the organization's local day (see the
  // `scheduled_job_runs` guard inside): the closest this project gets to a due/expiry cron before
  // Phase 20's durable job runner exists.
  await reconcileTimeBasedNotificationsBestEffort(session.organizationId);
  return (
    <AppShell
      variant="employee"
      userLabel={session.displayName}
      navItems={[
        { href: "/employee", label: "Home" },
        { href: "/employee/stations", label: "Stations" },
        { href: "/employee/training", label: "Training" },
        { href: "/employee/qualifications", label: "Qualifications" },
        { href: "/employee/checklists", label: "Checklists" },
        { href: "/employee/notifications", label: "Notifications" },
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
