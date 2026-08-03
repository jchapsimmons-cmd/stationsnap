"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

export function CreateDraftButton({
  sopId,
  redirectTo,
  label = "Start a new draft",
}: {
  sopId: string;
  redirectTo: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function createDraft() {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/management/sops/${sopId}/versions/draft`, {
        method: "POST",
      });
      const result = (await response.json()) as ApiResult<{ id: string }>;
      if (!result.ok) {
        setError(result.error?.message ?? "A new draft could not be started.");
        return;
      }
      router.push(redirectTo);
      router.refresh();
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="control-stack">
      <Button type="button" disabled={pending} onClick={createDraft}>
        {pending ? "Starting…" : label}
      </Button>
      {error && (
        <p className="form-status form-status--error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
