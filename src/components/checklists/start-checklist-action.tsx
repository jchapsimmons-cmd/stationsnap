"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

export function StartChecklistAction({ checklistId }: { checklistId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function start() {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/employee/checklists/${checklistId}/start`, {
        method: "POST",
      });
      const result = (await response.json()) as ApiResult<{ id: string }>;
      if (!result.ok || !result.data) {
        setError(result.error?.message ?? "This checklist could not be started.");
        return;
      }
      router.push(`/employee/checklist-runs/${result.data.id}`);
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="page-stack">
      <Button type="button" disabled={pending} onClick={() => void start()}>
        {pending ? "Starting…" : "Start checklist"}
      </Button>
      {error && (
        <p className="form-status form-status--error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
