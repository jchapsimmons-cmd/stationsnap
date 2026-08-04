"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Textarea } from "@/components/ui";

interface ApiResult {
  ok: boolean;
  error?: { message: string };
}

/** Revokes an active qualification. Revocation is permanent — there is no "unrevoke". */
export function QualificationRevokeForm({ qualificationId }: { qualificationId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
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
    <Card className="form-section">
      <h2>Revoke qualification</h2>
      <p className="muted">
        Revocation is permanent. The qualification&apos;s history stays visible afterward.
      </p>
      {error && (
        <p className="form-status form-status--error" role="alert">
          {error}
        </p>
      )}
      <Textarea
        id="qualification-revoke-note"
        label="Note (optional)"
        hint="Explain why this qualification is being revoked."
        maxLength={1000}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <Button type="button" variant="danger" disabled={pending} onClick={() => void submit()}>
        {pending ? "Revoking…" : "Revoke qualification"}
      </Button>
    </Card>
  );
}
