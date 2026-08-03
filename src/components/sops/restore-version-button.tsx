"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ConfirmationDialog } from "@/components/ui";

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

export function RestoreVersionButton({
  sopId,
  versionId,
  versionNumber,
}: {
  sopId: string;
  versionId: string;
  versionNumber: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function confirm() {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/management/sops/${sopId}/versions/${versionId}/restore`, {
        method: "POST",
      });
      const result = (await response.json()) as ApiResult<{ id: string }>;
      if (!result.ok) {
        setError(result.error?.message ?? "This version could not be restored.");
        setOpen(false);
        return;
      }
      setOpen(false);
      router.push(`/manager/sops/${sopId}/edit`);
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
      <Button type="button" variant="secondary" disabled={pending} onClick={() => setOpen(true)}>
        Restore this version
      </Button>
      {error && (
        <p className="form-status form-status--error" role="alert">
          {error}
        </p>
      )}
      <ConfirmationDialog
        open={open}
        title="Restore this version"
        description={`This clones version ${versionNumber} into a new editable draft. The published history is not changed.`}
        confirmLabel="Restore into a new draft"
        tone="primary"
        onConfirm={confirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
