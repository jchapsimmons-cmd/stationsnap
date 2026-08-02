import Link from "next/link";
import { EmptyState } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="centered-page" id="main-content">
      <EmptyState
        title="Page not found"
        description="The page may have moved or may not be available yet."
        action={
          <Link className="button button--primary" href="/">
            Return home
          </Link>
        }
      />
    </main>
  );
}
