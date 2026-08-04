"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ConfirmationDialog, Textarea } from "@/components/ui";

interface ApiResult {
  ok: boolean;
  error?: { message: string };
}

/** Revokes an active qualification episode. Manager-only; rendered only when `canRevoke` is true. */
export function RevokeQualificationForm({ qualificationId }: { qualificationId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function confirmRevoke() {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/management/qualifications/${qualificationId}/revoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const result = (await response.json()) as ApiResult;
      if (!result.ok) {
        setError(result.error?.message ?? "This qualification could not be revoked.");
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
    <Card className="form-section">
      <h2>Revoke qualification</h2>
      <p className="muted">
        Revoking ends this qualification immediately. It cannot be undone; a new episode is awarded
        only if the employee later completes the path again.
      </p>
      {error && (
        <p className="form-status form-status--error" role="alert">
          {error}
        </p>
      )}
      <Textarea
        id="revoke-note"
        label="Note (optional)"
        hint="Explain why this qualification is being revoked."
        maxLength={1_000}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <Button type="button" variant="danger" disabled={pending} onClick={() => setOpen(true)}>
        Revoke qualification
      </Button>
      <ConfirmationDialog
        open={open}
        title="Revoke qualification"
        description="This immediately ends the employee's active qualification. This cannot be undone."
        confirmLabel="Revoke qualification"
        onConfirm={() => void confirmRevoke()}
        onCancel={() => setOpen(false)}
      />
    </Card>
  );
}
