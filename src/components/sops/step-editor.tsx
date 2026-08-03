"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, CopySimple, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import {
  Button,
  Card,
  Checkbox,
  ConfirmationDialog,
  Input,
  Modal,
  Textarea,
} from "@/components/ui";
import { MediaUploadField, type FileSummary } from "@/components/sops/media-upload";

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

export interface StepRow {
  id: string;
  displayOrder: number;
  title: string | null;
  instruction: string;
  warning: string | null;
  quantity: string | null;
  unit: string | null;
  equipmentSetting: string | null;
  timerSeconds: number | null;
  isRequired: boolean;
  imageFile: FileSummary | null;
  videoFile: FileSummary | null;
}

interface StepFormState {
  title: string;
  instruction: string;
  warning: string;
  quantity: string;
  unit: string;
  equipmentSetting: string;
  timerSeconds: string;
  isRequired: boolean;
  imageFile: FileSummary | null;
  videoFile: FileSummary | null;
}

function emptyForm(): StepFormState {
  return {
    title: "",
    instruction: "",
    warning: "",
    quantity: "",
    unit: "",
    equipmentSetting: "",
    timerSeconds: "",
    isRequired: true,
    imageFile: null,
    videoFile: null,
  };
}

function toForm(step: StepRow): StepFormState {
  return {
    title: step.title ?? "",
    instruction: step.instruction,
    warning: step.warning ?? "",
    quantity: step.quantity ?? "",
    unit: step.unit ?? "",
    equipmentSetting: step.equipmentSetting ?? "",
    timerSeconds: step.timerSeconds ? String(step.timerSeconds) : "",
    isRequired: step.isRequired,
    imageFile: step.imageFile,
    videoFile: step.videoFile,
  };
}

export function StepEditor({
  sopId,
  initialSteps,
  initialRevision,
  readOnly,
}: {
  sopId: string;
  initialSteps: readonly StepRow[];
  initialRevision: number;
  readOnly: boolean;
}) {
  const [steps, setSteps] = useState<StepRow[]>([...initialSteps]);
  const [revision, setRevision] = useState(initialRevision);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [editingStepId, setEditingStepId] = useState<string | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StepRow | null>(null);
  const [form, setForm] = useState<StepFormState>(emptyForm());

  function openCreate() {
    setForm(emptyForm());
    setEditingStepId("new");
  }

  function openEdit(step: StepRow) {
    setForm(toForm(step));
    setEditingStepId(step.id);
  }

  async function applyResult(response: Response) {
    const result = (await response.json()) as ApiResult<{
      steps: StepRow[];
      version: { revision: number };
    }>;
    if (!result.ok || !result.data) {
      setError(result.error?.message ?? "That action could not be completed.");
      return false;
    }
    setSteps(result.data.steps);
    setRevision(result.data.version.revision);
    setError(undefined);
    return true;
  }

  async function submitStepForm() {
    setPending(true);
    setError(undefined);
    try {
      const payload = {
        title: form.title,
        instruction: form.instruction,
        warning: form.warning,
        quantity: form.quantity,
        unit: form.unit,
        equipmentSetting: form.equipmentSetting,
        timerSeconds: form.timerSeconds,
        isRequired: form.isRequired,
        imageFileId: form.imageFile?.id ?? "",
        videoFileId: form.videoFile?.id ?? "",
        expectedRevision: revision,
      };
      const url =
        editingStepId === "new"
          ? `/api/management/sops/${sopId}/steps`
          : `/api/management/sops/${sopId}/steps/${editingStepId}`;
      const response = await fetch(url, {
        method: editingStepId === "new" ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (await applyResult(response)) setEditingStepId(null);
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function duplicate(step: StepRow) {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/management/sops/${sopId}/steps/${step.id}/duplicate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: revision }),
      });
      await applyResult(response);
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/management/sops/${sopId}/steps/${deleteTarget.id}?expectedRevision=${revision}`,
        { method: "DELETE" },
      );
      await applyResult(response);
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPending(false);
      setDeleteTarget(null);
    }
  }

  async function move(step: StepRow, direction: -1 | 1) {
    const index = steps.findIndex((row) => row.id === step.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= steps.length) return;
    const reordered = [...steps];
    const [moved] = reordered.splice(index, 1);
    if (!moved) return;
    reordered.splice(targetIndex, 0, moved);
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/management/sops/${sopId}/steps/reorder`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderedStepIds: reordered.map((row) => row.id),
          expectedRevision: revision,
        }),
      });
      await applyResult(response);
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="page-stack">
      {error && (
        <p className="form-status form-status--error" role="alert">
          {error}
        </p>
      )}
      {readOnly && (
        <p className="form-status" role="status">
          This SOP is read-only. Archive it and create a new SOP to change its steps.
        </p>
      )}
      {steps.length === 0 ? (
        <Card>
          <p>No steps yet. Add the first step of this procedure.</p>
        </Card>
      ) : (
        <ol className="step-list">
          {steps.map((step, index) => (
            <li key={step.id}>
              <Card className="step-card">
                <div className="step-card__head">
                  <span className="step-order-badge" aria-hidden="true">
                    {step.displayOrder}
                  </span>
                  <div className="step-card__title">
                    <strong>{step.title || `Step ${step.displayOrder}`}</strong>
                    <small>{step.instruction}</small>
                  </div>
                  {!readOnly && (
                    <div className="reorder-buttons">
                      <Button
                        type="button"
                        variant="secondary"
                        aria-label={`Move step ${step.displayOrder} up`}
                        disabled={pending || index === 0}
                        onClick={() => move(step, -1)}
                      >
                        <ArrowUp size={18} aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        aria-label={`Move step ${step.displayOrder} down`}
                        disabled={pending || index === steps.length - 1}
                        onClick={() => move(step, 1)}
                      >
                        <ArrowDown size={18} aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                </div>
                {!readOnly && (
                  <div className="action-row">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => openEdit(step)}
                    >
                      <PencilSimple size={18} aria-hidden="true" />
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => duplicate(step)}
                    >
                      <CopySimple size={18} aria-hidden="true" />
                      Duplicate
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      disabled={pending}
                      onClick={() => setDeleteTarget(step)}
                    >
                      <Trash size={18} aria-hidden="true" />
                      Delete
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ol>
      )}
      {!readOnly && (
        <Button type="button" onClick={openCreate} disabled={pending}>
          <Plus size={19} aria-hidden="true" />
          Add step
        </Button>
      )}
      <Link className="button button--secondary" href={`/manager/sops/${sopId}/preview`}>
        Preview employee view
      </Link>

      <Modal
        open={editingStepId !== null}
        title={editingStepId === "new" ? "Add step" : "Edit step"}
        onClose={() => setEditingStepId(null)}
      >
        <div className="form-grid">
          <Input
            id="step-title"
            label="Step title"
            value={form.title}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
          />
          <Input
            id="step-timer"
            type="number"
            min={1}
            max={7200}
            label="Timer (seconds)"
            value={form.timerSeconds}
            onChange={(event) => setForm((prev) => ({ ...prev, timerSeconds: event.target.value }))}
          />
          <Input
            id="step-quantity"
            label="Quantity"
            value={form.quantity}
            onChange={(event) => setForm((prev) => ({ ...prev, quantity: event.target.value }))}
          />
          <Input
            id="step-unit"
            label="Unit"
            value={form.unit}
            onChange={(event) => setForm((prev) => ({ ...prev, unit: event.target.value }))}
          />
          <Input
            id="step-equipment"
            label="Equipment setting"
            value={form.equipmentSetting}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, equipmentSetting: event.target.value }))
            }
          />
        </div>
        <Textarea
          id="step-instruction"
          label="Instruction"
          required
          maxLength={4000}
          value={form.instruction}
          onChange={(event) => setForm((prev) => ({ ...prev, instruction: event.target.value }))}
        />
        <Input
          id="step-warning"
          label="Warning"
          value={form.warning}
          onChange={(event) => setForm((prev) => ({ ...prev, warning: event.target.value }))}
        />
        <div className="form-grid">
          <MediaUploadField
            id="step-image"
            label="Step image"
            kind="image"
            value={form.imageFile}
            onChange={(file) => setForm((prev) => ({ ...prev, imageFile: file }))}
          />
          <MediaUploadField
            id="step-video"
            label="Step video clip"
            kind="video"
            value={form.videoFile}
            onChange={(file) => setForm((prev) => ({ ...prev, videoFile: file }))}
          />
        </div>
        <Checkbox
          id="step-required"
          label="Required step"
          checked={form.isRequired}
          onChange={(event) => setForm((prev) => ({ ...prev, isRequired: event.target.checked }))}
        />
        <div className="modal__actions">
          <Button type="button" variant="secondary" onClick={() => setEditingStepId(null)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending || form.instruction.trim().length === 0}
            onClick={submitStepForm}
          >
            {pending ? "Saving…" : "Save step"}
          </Button>
        </div>
      </Modal>

      <ConfirmationDialog
        open={deleteTarget !== null}
        title="Delete step"
        description={`Delete "${deleteTarget?.title || `Step ${deleteTarget?.displayOrder ?? ""}`}"? This cannot be undone.`}
        confirmLabel="Delete step"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
