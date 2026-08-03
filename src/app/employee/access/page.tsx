import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { EmployeeAccessForm } from "@/components/auth/auth-forms";
import { safeReturnTo } from "@/server/auth/request-security";
import { getCurrentEmployeeSession } from "@/server/auth/sessions";

export const dynamic = "force-dynamic";

export default async function EmployeeAccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (await getCurrentEmployeeSession()) redirect("/employee");
  const returnTo = safeReturnTo((await searchParams)["returnTo"], "/employee");
  return (
    <AuthShell
      eyebrow="Employee access"
      title="Find your restaurant"
      description="Enter the restaurant and location codes provided by your manager."
      alternate={{ href: "/manager/login", label: "I’m a manager" }}
    >
      <EmployeeAccessForm returnTo={returnTo} />
    </AuthShell>
  );
}
