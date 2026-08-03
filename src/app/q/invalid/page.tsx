import Link from "next/link";
import { EmptyState } from "@/components/ui";

export default function InvalidQrPage() {
  return (
    <div className="page-stack auth-shell">
      <EmptyState
        title="This QR code isn't available"
        description="It may be revoked, expired, or no longer point to something you can access. Ask your manager for an updated QR code, or sign in directly."
      />
      <Link className="button button--primary" href="/employee/access">
        Go to employee access
      </Link>
    </div>
  );
}
