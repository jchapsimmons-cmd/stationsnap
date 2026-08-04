"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Textarea } from "@/components/ui";

interface ApiResult {
  ok: boolean;
  error?: { message: string };
}

export interface CorrectionStep {
  id: string;
  displayOrder: number;
  title: string | null;
  acceptsPhoto: boolean;
  acceptsVideo: boolean;
  evidenceCount: number;
}

/**
 * Uploads replacement evidence for one step and resubmits the correction. The upload is
 * append-only on the server: the employee's original evidence stays attached to the attempt, and
 * a new approval submission generation is opened for the manager.
 */
export function CorrectionResubmitForm({
  submissionId,
  expectedRevision,
  steps,
}: {
  submissionId: string;
  expectedRevision: number;
  steps: readonly CorrectionStep[];
}) {
  const router = useRouter();
  const [stepId, setStepId] = useState(steps[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [employeeNote, setEmployeeNote] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const selectedStep = steps.find((step) => step.id === stepId) ?? null;
  const accept = selectedStep
    ? [selectedStep.acceptsPhoto ? "image/*" : "", selectedStep.acceptsVideo ? "video/*" : ""]
        .filter(Boolean)
        .join(",")
    : "image/*,video/*";

  async function submit() {
    if (!file || !stepId) return;
    setError(undefined);
    setPending(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("stepId", stepId);
      formData.set("employeeNote", employeeNote);
      formData.set("expectedRevision", String(expectedRevision));
      const response = await fetch(`/api/employee/approvals/${submissionId}/resubmit`, {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as ApiResult;
      if (!result.ok) {
        setError(result.error?.message ?? "That correction could not be resubmitted.");
        return;
      }
      router.refresh();
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (steps.length === 0) {
    return (
      <Card>
        <p role="status">
          This training has no step that accepts replacement proof. Ask your manager what to do
          next.
        </p>
      </Card>
    );
  }

  return (
    <Card className="form-section">
      <h2>Send the fix</h2>
      {error && (
        <p className="form-status form-status--error" role="alert">
          {error}
        </p>
      )}
      <fieldset className="checkbox-list">
        <legend className="field__label">Which step are you redoing?</legend>
        {steps.map((step) => (
          <label className="check-control" key={step.id}>
            <input
              type="radio"
              name="correction-step"
              value={step.id}
              checked={stepId === step.id}
              onChange={() => setStepId(step.id)}
            />
            <span>
              Step {step.displayOrder}
              {step.title ? ` · ${step.title}` : ""}
              <small className="field__message">
                {step.evidenceCount} previous submission{step.evidenceCount === 1 ? "" : "s"} kept
              </small>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label className="field__label" htmlFor="correction-evidence">
          New {selectedStep?.acceptsVideo && !selectedStep.acceptsPhoto ? "video" : "photo"} proof
        </label>
        <input
          id="correction-evidence"
          type="file"
          accept={accept}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </div>
      <Textarea
        id="correction-note"
        label="Note for your manager (optional)"
        hint="Say what you changed."
        maxLength={500}
        value={employeeNote}
        onChange={(event) => setEmployeeNote(event.target.value)}
      />
      <Button type="button" disabled={pending || !file || !stepId} onClick={() => void submit()}>
        {pending ? "Sending…" : "Resubmit for review"}
      </Button>
    </Card>
  );
}
