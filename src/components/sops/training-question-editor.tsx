"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import {
  Button,
  Card,
  Checkbox,
  ConfirmationDialog,
  Input,
  Modal,
  Select,
  Textarea,
} from "@/components/ui";
import {
  trainingExplanationPolicyValues,
  trainingQuestionTypeValues,
  type TrainingQuestionCreateInput,
} from "@/server/sops/schemas";

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

export interface QuestionChoiceRow {
  id: string;
  text: string;
  isCorrect: boolean;
  displayOrder: number;
}

export interface QuestionRow {
  id: string;
  stepId: string | null;
  type: (typeof trainingQuestionTypeValues)[number];
  text: string;
  explanation: string;
  points: number;
  placement: TrainingQuestionCreateInput["placement"];
  displayOrder: number;
  explanationPolicy: (typeof trainingExplanationPolicyValues)[number];
  choices: readonly QuestionChoiceRow[];
}

export interface QuestionStepOption {
  id: string;
  displayOrder: number;
  title: string | null;
}

interface FormChoice {
  text: string;
  isCorrect: boolean;
}

interface FormState {
  stepId: string;
  type: (typeof trainingQuestionTypeValues)[number];
  text: string;
  explanation: string;
  points: string;
  explanationPolicy: (typeof trainingExplanationPolicyValues)[number];
  choices: FormChoice[];
}

const TYPE_LABELS: Record<(typeof trainingQuestionTypeValues)[number], string> = {
  single_choice: "Single choice",
  multiple_choice: "Multiple choice",
  true_false: "True / false",
};

const EXPLANATION_POLICY_LABELS: Record<(typeof trainingExplanationPolicyValues)[number], string> =
  {
    never: "Never show the explanation",
    on_incorrect: "Show the explanation only on an incorrect answer",
    always: "Always show the explanation",
  };

function emptyForm(): FormState {
  return {
    stepId: "",
    type: "single_choice",
    text: "",
    explanation: "",
    points: "1",
    explanationPolicy: "on_incorrect",
    choices: [
      { text: "", isCorrect: true },
      { text: "", isCorrect: false },
    ],
  };
}

function toForm(question: QuestionRow): FormState {
  return {
    stepId: question.stepId ?? "",
    type: question.type,
    text: question.text,
    explanation: question.explanation,
    points: String(question.points),
    explanationPolicy: question.explanationPolicy,
    choices: question.choices.map((choice) => ({ text: choice.text, isCorrect: choice.isCorrect })),
  };
}

function choicesForType(
  type: (typeof trainingQuestionTypeValues)[number],
  current: FormChoice[],
): FormChoice[] {
  if (type === "true_false") {
    return [
      { text: "True", isCorrect: current[0]?.isCorrect ?? true },
      { text: "False", isCorrect: current[1]?.isCorrect ?? false },
    ];
  }
  return current;
}

export function TrainingQuestionEditor({
  sopId,
  initialQuestions,
  initialRevision,
  steps,
}: {
  sopId: string;
  initialQuestions: readonly QuestionRow[];
  initialRevision: number;
  steps: readonly QuestionStepOption[];
}) {
  const [questions, setQuestions] = useState<QuestionRow[]>([...initialQuestions]);
  const [revision, setRevision] = useState(initialRevision);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [editingQuestionId, setEditingQuestionId] = useState<string | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QuestionRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  const stepQuestions = new Map<string, QuestionRow[]>();
  const finalQuestions: QuestionRow[] = [];
  for (const question of questions) {
    if (question.stepId) {
      const list = stepQuestions.get(question.stepId) ?? [];
      list.push(question);
      stepQuestions.set(question.stepId, list);
    } else {
      finalQuestions.push(question);
    }
  }

  function openCreate(stepId: string) {
    setForm({ ...emptyForm(), stepId });
    setEditingQuestionId("new");
  }

  function openEdit(question: QuestionRow) {
    setForm(toForm(question));
    setEditingQuestionId(question.id);
  }

  async function applyResult(response: Response) {
    const result = (await response.json()) as ApiResult<{
      revision: number;
      questions: QuestionRow[];
    }>;
    if (!result.ok || !result.data) {
      setError(result.error?.message ?? "That action could not be completed.");
      return false;
    }
    setQuestions(result.data.questions);
    setRevision(result.data.revision);
    setError(undefined);
    return true;
  }

  async function submitQuestionForm() {
    setPending(true);
    setError(undefined);
    try {
      const payload = {
        stepId: form.stepId,
        type: form.type,
        text: form.text,
        explanation: form.explanation,
        points: form.points,
        placement: form.stepId ? "after_step" : "final",
        explanationPolicy: form.explanationPolicy,
        choices: form.choices,
        expectedRevision: revision,
      };
      const url =
        editingQuestionId === "new"
          ? `/api/management/sops/${sopId}/training/questions`
          : `/api/management/sops/${sopId}/training/questions/${editingQuestionId}`;
      const response = await fetch(url, {
        method: editingQuestionId === "new" ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (await applyResult(response)) setEditingQuestionId(null);
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
        `/api/management/sops/${sopId}/training/questions/${deleteTarget.id}?expectedRevision=${revision}`,
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

  async function move(group: readonly QuestionRow[], question: QuestionRow, direction: -1 | 1) {
    const index = group.findIndex((row) => row.id === question.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= group.length) return;
    const reordered = [...group];
    const [moved] = reordered.splice(index, 1);
    if (!moved) return;
    reordered.splice(targetIndex, 0, moved);
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/management/sops/${sopId}/training/questions/reorder`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          stepId: question.stepId ?? "",
          orderedQuestionIds: reordered.map((row) => row.id),
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

  function renderGroup(title: string, stepId: string, group: QuestionRow[]) {
    return (
      <Card className="form-section" key={stepId || "final"}>
        <h2>{title}</h2>
        {group.length === 0 ? (
          <p>No questions yet. This is fine; questions are optional here.</p>
        ) : (
          <ol className="step-list">
            {group.map((question, index) => (
              <li key={question.id}>
                <Card className="step-card">
                  <div className="step-card__head">
                    <span className="step-order-badge" aria-hidden="true">
                      {question.displayOrder}
                    </span>
                    <div className="step-card__title">
                      <strong>{question.text}</strong>
                      <small>
                        {TYPE_LABELS[question.type]} · {question.points} pt
                        {question.points === 1 ? "" : "s"}
                      </small>
                    </div>
                    <div className="reorder-buttons">
                      <Button
                        type="button"
                        variant="secondary"
                        aria-label={`Move question ${index + 1} up`}
                        disabled={pending || index === 0}
                        onClick={() => void move(group, question, -1)}
                      >
                        <ArrowUp size={18} aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        aria-label={`Move question ${index + 1} down`}
                        disabled={pending || index === group.length - 1}
                        onClick={() => void move(group, question, 1)}
                      >
                        <ArrowDown size={18} aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                  <div className="action-row">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => openEdit(question)}
                    >
                      <PencilSimple size={18} aria-hidden="true" />
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      disabled={pending}
                      onClick={() => setDeleteTarget(question)}
                    >
                      <Trash size={18} aria-hidden="true" />
                      Delete
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        )}
        <Button type="button" onClick={() => openCreate(stepId)} disabled={pending}>
          <Plus size={19} aria-hidden="true" />
          Add question
        </Button>
      </Card>
    );
  }

  return (
    <div className="page-stack">
      {error && (
        <p className="form-status form-status--error" role="alert">
          {error}
        </p>
      )}

      {steps.map((step) =>
        renderGroup(
          `Step ${step.displayOrder}${step.title ? ` · ${step.title}` : ""} questions`,
          step.id,
          stepQuestions.get(step.id) ?? [],
        ),
      )}

      {renderGroup("Final questions", "", finalQuestions)}

      <Modal
        open={editingQuestionId !== null}
        title={editingQuestionId === "new" ? "Add question" : "Edit question"}
        onClose={() => setEditingQuestionId(null)}
      >
        <div className="form-grid">
          <Select
            id="question-step"
            label="Attached to"
            value={form.stepId}
            disabled={editingQuestionId === "new"}
            onChange={(event) => setForm((prev) => ({ ...prev, stepId: event.target.value }))}
          >
            <option value="">Final question</option>
            {steps.map((step) => (
              <option key={step.id} value={step.id}>
                Step {step.displayOrder}
                {step.title ? ` · ${step.title}` : ""}
              </option>
            ))}
          </Select>
          <Select
            id="question-type"
            label="Question type"
            value={form.type}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                type: event.target.value as FormState["type"],
                choices: choicesForType(event.target.value as FormState["type"], prev.choices),
              }))
            }
          >
            {trainingQuestionTypeValues.map((value) => (
              <option key={value} value={value}>
                {TYPE_LABELS[value]}
              </option>
            ))}
          </Select>
          <Input
            id="question-points"
            type="number"
            min={1}
            max={100}
            label="Points"
            value={form.points}
            onChange={(event) => setForm((prev) => ({ ...prev, points: event.target.value }))}
          />
          <Select
            id="question-explanation-policy"
            label="Explanation visibility"
            value={form.explanationPolicy}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                explanationPolicy: event.target.value as FormState["explanationPolicy"],
              }))
            }
          >
            {trainingExplanationPolicyValues.map((value) => (
              <option key={value} value={value}>
                {EXPLANATION_POLICY_LABELS[value]}
              </option>
            ))}
          </Select>
        </div>
        <Textarea
          id="question-text"
          label="Question"
          required
          maxLength={1000}
          value={form.text}
          onChange={(event) => setForm((prev) => ({ ...prev, text: event.target.value }))}
        />
        <Textarea
          id="question-explanation"
          label="Explanation"
          maxLength={2000}
          value={form.explanation}
          onChange={(event) => setForm((prev) => ({ ...prev, explanation: event.target.value }))}
        />

        <fieldset className="form-section">
          <legend>Choices</legend>
          {form.choices.map((choice, index) => (
            <div className="repeatable-row" key={index}>
              <Input
                id={`question-choice-${index}`}
                label={`Choice ${index + 1}`}
                value={choice.text}
                disabled={form.type === "true_false"}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    choices: prev.choices.map((row, rowIndex) =>
                      rowIndex === index ? { ...row, text: event.target.value } : row,
                    ),
                  }))
                }
              />
              <Checkbox
                id={`question-choice-${index}-correct`}
                label="Correct"
                checked={choice.isCorrect}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    choices: prev.choices.map((row, rowIndex) =>
                      form.type === "single_choice" || form.type === "true_false"
                        ? { ...row, isCorrect: rowIndex === index && event.target.checked }
                        : rowIndex === index
                          ? { ...row, isCorrect: event.target.checked }
                          : row,
                    ),
                  }))
                }
              />
              {form.type !== "true_false" && form.choices.length > 2 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      choices: prev.choices.filter((_, rowIndex) => rowIndex !== index),
                    }))
                  }
                >
                  Remove
                </Button>
              )}
            </div>
          ))}
          {form.type !== "true_false" && form.choices.length < 8 && (
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setForm((prev) => ({
                  ...prev,
                  choices: [...prev.choices, { text: "", isCorrect: false }],
                }))
              }
            >
              Add choice
            </Button>
          )}
        </fieldset>

        <div className="modal__actions">
          <Button type="button" variant="secondary" onClick={() => setEditingQuestionId(null)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending || form.text.trim().length === 0}
            onClick={submitQuestionForm}
          >
            {pending ? "Saving…" : "Save question"}
          </Button>
        </div>
      </Modal>

      <ConfirmationDialog
        open={deleteTarget !== null}
        title="Delete question"
        description={`Delete "${deleteTarget?.text ?? ""}"? This cannot be undone.`}
        confirmLabel="Delete question"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
