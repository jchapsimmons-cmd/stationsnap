"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

export function StartOrResumeAction({
  assignmentId,
  label,
}: {
  assignmentId: string;
  label: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function start() {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/employee/training/assignments/${assignmentId}/session`, {
        method: "POST",
      });
      const result = (await response.json()) as ApiResult<{ id: string }>;
      if (!result.ok || !result.data) {
        setError(result.error?.message ?? "Training could not be started.");
        return;
      }
      router.push(`/employee/training/${assignmentId}/session/${result.data.id}`);
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="page-stack">
      <Button type="button" disabled={pending} onClick={() => void start()}>
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
