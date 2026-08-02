"use client";

import { Button, ErrorState } from "@/components/ui";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="centered-page" id="main-content">
      <ErrorState
        description="We couldn’t load this page. Your saved work has not been changed."
        retry={<Button onClick={reset}>Try again</Button>}
      />
    </main>
  );
}
