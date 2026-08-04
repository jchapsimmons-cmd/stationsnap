"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Textarea } from "@/components/ui";

interface ApiResult {
  ok: boolean;
  error?: { message: string };
}

type Decision = "approved" | "rejected" | "needs_correction";

const DECISION_OPTIONS: ReadonlyArray<{
  value: Decision;
  label: string;
  hint: string;
  noteRequired: boolean;
}> = [
  {
    value: "approved",
    label: "Approve",
    hint: "The evidence proves the procedure was followed. A note is optional.",
    noteRequired: false,
  },
  {
    value: "needs_correction",
    label: "Request a correction",
    hint: "Send it back so the employee can redo a step and upload replacement evidence.",
    noteRequired: true,
  },
  {
    value: "rejected",
    label: "Reject",
    hint: "End this attempt as not passed. Explain what was wrong.",
    noteRequired: true,
  },
];

/**
 * Records one decision on a pending submission. The note requirement mirrors the server-side
 * discriminated union exactly: mandatory for a rejection or a correction, optional for approval.
 * A decided submission is never re-decided, so this form is only rendered while one is pending.
 */
export function ApprovalDecisionForm({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [decision, setDecision] = useState<Decision>("approved");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const selected = DECISION_OPTIONS.find((option) => option.value === decision);
  const noteRequired = selected?.noteRequired ?? false;
  const noteMissing = noteRequired && note.trim().length === 0;

  async function submit() {
    setError(undefined);
    setPending(true);
    try {
      const response = await fetch(`/api/management/training/approvals/${submissionId}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, note }),
      });
      const result = (await response.json()) as ApiResult;
      if (!result.ok) {
        setError(result.error?.message ?? "That decision could not be recorded.");
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
      <h2>Record a decision</h2>
      <p className="muted">
        Decisions are permanent. This submission cannot be decided twice, and the note you leave
        stays in the history for every later review.
      </p>
      {error && (
        <p className="form-status form-status--error" role="alert">
          {error}
        </p>
      )}
      <fieldset className="checkbox-list">
        <legend className="field__label">Decision</legend>
        {DECISION_OPTIONS.map((option) => (
          <label className="check-control" key={option.value}>
            <input
              type="radio"
              name="decision"
              value={option.value}
              checked={decision === option.value}
              onChange={() => setDecision(option.value)}
            />
            <span>
              {option.label}
              <small className="field__message">{option.hint}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <Textarea
        id="approval-decision-note"
        label={noteRequired ? "Note (required)" : "Note (optional)"}
        hint={
          noteRequired
            ? "Tell the employee exactly what to fix."
            : "Add anything the employee should know."
        }
        maxLength={1000}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <Button type="button" disabled={pending || noteMissing} onClick={() => void submit()}>
        {pending ? "Recording…" : (selected?.label ?? "Record decision")}
      </Button>
    </Card>
  );
}
