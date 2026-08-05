"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

/** Marks one notification read via a bodyless POST, then refreshes the list — same idiom as
 * `QrRevokeButton`/`StartChecklistAction`. `readHref` is `/api/management/notifications/[id]/read`
 * or `/api/employee/notifications/[id]/read` depending on which page renders this. */
export function MarkNotificationReadButton({ readHref }: { readHref: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function markRead() {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(readHref, { method: "POST" });
      const result = (await response.json()) as ApiResult<{ id: string }>;
      if (!result.ok) {
        setError(result.error?.message ?? "This notification could not be marked read.");
        return;
      }
      router.refresh();
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span>
      <Button type="button" variant="secondary" disabled={pending} onClick={() => void markRead()}>
        {pending ? "Marking…" : "Mark as read"}
      </Button>
      {error && (
        <p className="form-status form-status--error" role="alert">
          {error}
        </p>
      )}
    </span>
  );
}
