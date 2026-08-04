"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, StatusBadge, Textarea } from "@/components/ui";

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

interface RunItemEvidence {
  id: string;
  fileId: string;
  submissionGeneration: number;
  employeeNote: string;
  createdAt: string;
}

interface RunItem {
  id: string;
  displayOrder: number;
  title: string;
  instructions: string;
  isRequired: boolean;
  timerSeconds: number | null;
  requirePhoto: boolean;
  requireApproval: boolean;
  requireNote: boolean;
  status: "pending" | "in_progress" | "completed";
  timerCompleted: boolean;
  employeeNote: string;
  isDone: boolean;
  evidence: RunItemEvidence[];
}

export interface ChecklistRunState {
  id: string;
  checklistId: string;
  checklistTitle: string;
  status: "in_progress" | "awaiting_approval" | "submitted" | "rejected";
  revision: number;
  items: RunItem[];
}

function ItemNoteField({
  item,
  disabled,
  onSave,
}: {
  item: RunItem;
  disabled: boolean;
  onSave: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState(item.employeeNote);
  const [pending, setPending] = useState(false);

  return (
    <div className="field">
      <Textarea
        id={`checklist-item-note-${item.id}`}
        label={item.requireNote ? "Note (required)" : "Note (optional)"}
        maxLength={500}
        value={note}
        disabled={disabled}
        onChange={(event) => setNote(event.target.value)}
      />
      <Button
        type="button"
        variant="secondary"
        disabled={disabled || pending}
        onClick={() => {
          setPending(true);
          void onSave(note).finally(() => setPending(false));
        }}
      >
        {pending ? "Saving…" : "Save note"}
      </Button>
    </div>
  );
}

export function ChecklistRunRunner({
  runId,
  initialState,
}: {
  runId: string;
  initialState: ChecklistRunState;
}) {
  const router = useRouter();
  const [state, setState] = useState<ChecklistRunState>(initialState);
  const [error, setError] = useState<string>();
  const [submitPending, setSubmitPending] = useState(false);
  const [timerRemaining, setTimerRemaining] = useState<Record<string, number>>({});

  const basePath = `/api/employee/checklist-runs/${runId}`;
  const disabled = state.status !== "in_progress" && state.status !== "awaiting_approval";

  async function applyResult(promise: Promise<Response>) {
    setError(undefined);
    try {
      const response = await promise;
      const result = (await response.json()) as ApiResult<ChecklistRunState>;
      if (!result.ok || !result.data) {
        setError(result.error?.message ?? "That action could not be completed.");
        return;
      }
      setState(result.data);
    } catch {
      setError("StationSnap could not be reached. Try again.");
    }
  }

  async function recordAction(itemId: string, action: "ticked" | "unticked" | "timer_completed") {
    await applyResult(
      fetch(`${basePath}/items/${itemId}/action`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, expectedRevision: state.revision }),
      }),
    );
  }

  async function saveNote(itemId: string, employeeNote: string) {
    await applyResult(
      fetch(`${basePath}/items/${itemId}/note`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ employeeNote, expectedRevision: state.revision }),
      }),
    );
  }

  async function uploadEvidence(itemId: string, file: File) {
    const formData = new FormData();
    formData.set("file", file);
    formData.set("employeeNote", "");
    formData.set("expectedRevision", String(state.revision));
    await applyResult(
      fetch(`${basePath}/items/${itemId}/evidence`, { method: "POST", body: formData }),
    );
  }

  function startTimer(itemId: string, seconds: number) {
    setTimerRemaining((prev) => ({ ...prev, [itemId]: seconds }));
    const interval = setInterval(() => {
      setTimerRemaining((prev) => {
        const remaining = (prev[itemId] ?? 0) - 1;
        if (remaining <= 0) {
          clearInterval(interval);
          void recordAction(itemId, "timer_completed");
          return { ...prev, [itemId]: 0 };
        }
        return { ...prev, [itemId]: remaining };
      });
    }, 1000);
  }

  async function submitRun() {
    setSubmitPending(true);
    try {
      const response = await fetch(`${basePath}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: state.revision }),
      });
      const result = (await response.json()) as ApiResult<ChecklistRunState>;
      if (!result.ok || !result.data) {
        setError(result.error?.message ?? "This checklist could not be submitted.");
        return;
      }
      setState(result.data);
      router.push("/employee/checklists");
      router.refresh();
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setSubmitPending(false);
    }
  }

  if (state.status === "submitted" || state.status === "rejected") {
    return (
      <Card>
        <p role="status">
          {state.status === "submitted"
            ? "This checklist has already been submitted."
            : "This checklist run was rejected. Start a new run to try again."}
        </p>
      </Card>
    );
  }

  const requiredItems = state.items.filter((item) => item.isRequired);
  const allRequiredDone = requiredItems.every((item) => item.isDone);

  return (
    <div className="page-stack">
      {error && (
        <p className="form-status form-status--error" role="alert">
          {error}
        </p>
      )}
      {state.status === "awaiting_approval" && (
        <Card>
          <p role="status">
            This checklist is awaiting manager review. If a correction was requested, upload
            replacement evidence below and it will be resubmitted automatically.
          </p>
        </Card>
      )}

      <ol className="step-list">
        {state.items.map((item) => (
          <li key={item.id}>
            <Card className="step-card">
              <div className="step-card__head">
                <span className="step-order-badge" aria-hidden="true">
                  {item.displayOrder}
                </span>
                <div className="step-card__title">
                  <strong>{item.title}</strong>
                  {item.instructions && <small>{item.instructions}</small>}
                </div>
                <StatusBadge tone={item.isDone ? "success" : "neutral"}>
                  {item.isDone ? "Done" : item.isRequired ? "Required" : "Optional"}
                </StatusBadge>
              </div>

              {item.timerSeconds === null && !item.requirePhoto && !item.requireNote && (
                <Button
                  type="button"
                  variant={item.status === "completed" ? "secondary" : "primary"}
                  disabled={disabled}
                  onClick={() =>
                    void recordAction(item.id, item.status === "completed" ? "unticked" : "ticked")
                  }
                >
                  {item.status === "completed" ? "Undo" : "Mark done"}
                </Button>
              )}

              {item.timerSeconds !== null && (
                <div className="timer">
                  {item.timerCompleted ? (
                    <StatusBadge tone="success">Timer complete</StatusBadge>
                  ) : timerRemaining[item.id] != null ? (
                    <p>{timerRemaining[item.id]}s remaining</p>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={disabled}
                      onClick={() => startTimer(item.id, item.timerSeconds ?? 0)}
                    >
                      Start {item.timerSeconds}s timer
                    </Button>
                  )}
                </div>
              )}

              {item.requirePhoto && (
                <div className="field">
                  <label className="field__label" htmlFor={`checklist-evidence-${item.id}`}>
                    Upload a photo as proof
                  </label>
                  <input
                    id={`checklist-evidence-${item.id}`}
                    type="file"
                    accept="image/*"
                    disabled={disabled}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadEvidence(item.id, file);
                    }}
                  />
                  {item.evidence.length > 0 && (
                    <p className="field__message">
                      {item.evidence.length} photo{item.evidence.length === 1 ? "" : "s"} uploaded.
                    </p>
                  )}
                </div>
              )}

              {(item.requireNote || item.employeeNote) && (
                <ItemNoteField
                  item={item}
                  disabled={disabled}
                  onSave={(note) => saveNote(item.id, note)}
                />
              )}
            </Card>
          </li>
        ))}
      </ol>

      {state.status === "in_progress" && (
        <Button
          type="button"
          disabled={!allRequiredDone || submitPending}
          onClick={() => void submitRun()}
        >
          {submitPending ? "Submitting…" : "Submit checklist"}
        </Button>
      )}
    </div>
  );
}
