import { AuthShell } from "@/components/auth/auth-shell";
import { PasswordResetConfirmForm } from "@/components/auth/auth-forms";

export default async function ManagerRecoverConfirmPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tokenValue = (await searchParams)["token"];
  const token = typeof tokenValue === "string" ? tokenValue : "";
  return (
    <AuthShell
      eyebrow="Manager access"
      title="Choose a new password"
      description={
        token
          ? "This link can be used once and expires after 30 minutes."
          : "This password-reset link is incomplete."
      }
      alternate={{ href: "/manager/recover", label: "Request another reset link" }}
    >
      <PasswordResetConfirmForm token={token} />
    </AuthShell>
  );
}
