"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

export function PublishButton({
  sopId,
  revision,
  disabled,
}: {
  sopId: string;
  revision: number;
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function publish() {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/management/sops/${sopId}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: revision }),
      });
      const result = (await response.json()) as ApiResult<{ id: string }>;
      if (!result.ok) {
        setError(result.error?.message ?? "This SOP could not be published.");
        return;
      }
      router.push(`/manager/sops/${sopId}`);
      router.refresh();
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="control-stack">
      <Button type="button" disabled={disabled || pending} onClick={publish}>
        {pending ? "Publishing…" : "Publish SOP"}
      </Button>
      {error && (
        <p className="form-status form-status--error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
