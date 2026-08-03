import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { EmployeeLoginForm } from "@/components/auth/auth-forms";
import { safeReturnTo } from "@/server/auth/request-security";
import { getCurrentEmployeeSession } from "@/server/auth/sessions";

export const dynamic = "force-dynamic";

export default async function EmployeeLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (await getCurrentEmployeeSession()) redirect("/employee");
  const params = await searchParams;
  const organizationSlug = typeof params["organization"] === "string" ? params["organization"] : "";
  const locationSlug = typeof params["location"] === "string" ? params["location"] : "";
  if (!organizationSlug || !locationSlug) redirect("/employee/access");
  const returnTo = safeReturnTo(params["returnTo"], "/employee");
  return (
    <AuthShell
      eyebrow="Employee access"
      title="Enter your PIN"
      description="Use your employee number and four-digit PIN. Repeated failed attempts temporarily lock access."
      alternate={{ href: "/employee/access", label: "Choose a different location" }}
    >
      <EmployeeLoginForm
        organizationSlug={organizationSlug}
        locationSlug={locationSlug}
        returnTo={returnTo}
      />
    </AuthShell>
  );
}
