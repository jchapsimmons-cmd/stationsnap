import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { ManagerLoginForm } from "@/components/auth/auth-forms";
import { safeReturnTo } from "@/server/auth/request-security";
import { getCurrentManagerSession } from "@/server/auth/sessions";

export const dynamic = "force-dynamic";

export default async function ManagerLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (await getCurrentManagerSession()) redirect("/manager");
  const params = await searchParams;
  const returnTo = safeReturnTo(params["returnTo"], "/manager");
  return (
    <AuthShell
      eyebrow="Manager access"
      title="Welcome back"
      description="Sign in with your StationSnap manager account."
      alternate={{ href: "/employee/access", label: "I’m an employee" }}
    >
      <ManagerLoginForm returnTo={returnTo} />
    </AuthShell>
  );
}
