"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ConfirmationDialog } from "@/components/ui";

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

export function ArchiveButton({ sopId }: { sopId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function confirm() {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/management/sops/${sopId}/archive`, { method: "POST" });
      const result = (await response.json()) as ApiResult<{ id: string }>;
      if (!result.ok) {
        setError(result.error?.message ?? "This SOP could not be archived.");
        setOpen(false);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("StationSnap could not be reached. Try again.");
      setOpen(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button type="button" variant="danger" disabled={pending} onClick={() => setOpen(true)}>
        Archive SOP
      </Button>
      {error && (
        <p className="form-status form-status--error" role="alert">
          {error}
        </p>
      )}
      <ConfirmationDialog
        open={open}
        title="Archive SOP"
        description="Archived SOPs are no longer active. This does not delete its history."
        confirmLabel="Archive SOP"
        onConfirm={confirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
