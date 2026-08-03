import { AuthShell } from "@/components/auth/auth-shell";
import { PasswordResetRequestForm } from "@/components/auth/auth-forms";

export default function ManagerRecoverPage() {
  return (
    <AuthShell
      eyebrow="Manager access"
      title="Reset your password"
      description="We’ll send a time-limited reset link if the account is active."
      alternate={{ href: "/manager/login", label: "Return to manager sign in" }}
    >
      <PasswordResetRequestForm />
    </AuthShell>
  );
}
