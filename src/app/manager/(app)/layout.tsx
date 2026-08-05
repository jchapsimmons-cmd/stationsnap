import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireManagerPage } from "@/server/auth/authorization";
import { reconcileTimeBasedNotificationsBestEffort } from "@/server/notifications/service";

export const dynamic = "force-dynamic";

export default async function ManagerLayout({ children }: { children: ReactNode }) {
  const session = await requireManagerPage("/manager");
  // Best-effort, cheap after the first page view of the organization's local day (see the
  // `scheduled_job_runs` guard inside): the closest this project gets to a due/expiry cron before
  // Phase 20's durable job runner exists.
  await reconcileTimeBasedNotificationsBestEffort(session.organizationId);
  const navItems = [
    { href: "/manager", label: "Overview" },
    { href: "/manager/activity", label: "Activity" },
    { href: "/manager/notifications", label: "Notifications" },
    { href: "/manager/reports", label: "Reports" },
    { href: "/manager/sops", label: "SOPs" },
    { href: "/manager/training/assignments", label: "Training" },
    { href: "/manager/training/approvals", label: "Approvals" },
    { href: "/manager/training/paths", label: "Training paths" },
    { href: "/manager/qualifications", label: "Qualifications" },
    { href: "/manager/checklists", label: "Checklists" },
    { href: "/manager/checklist-runs", label: "Checklist runs" },
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
