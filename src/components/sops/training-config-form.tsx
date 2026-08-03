"use client";

import { useState } from "react";
import { Button, Card, Input, Select, Toggle } from "@/components/ui";
import { trainingModeValues, trainingRequirementStateValues } from "@/server/sops/schemas";

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

export interface TrainingConfigValue {
  requirementState: (typeof trainingRequirementStateValues)[number];
  defaultMode: (typeof trainingModeValues)[number];
  allowBacktracking: boolean;
  requireSequentialProgress: boolean;
  requireFullVideoWatch: boolean;
  requireEvidenceApproval: boolean;
  passingScorePercent: number;
  maxAttempts: number;
  qualificationValidityDays: number | null;
  retrainingGraceDays: number | null;
}

export interface StepRequirementsValue {
  requireFullVideo: boolean;
  requireConfirmation: boolean;
  requireTimer: boolean;
  requireQuestion: boolean;
  requirePhoto: boolean;
  requireVideo: boolean;
  requireApproval: boolean;
}

export interface TrainingStepSummary {
  id: string;
  displayOrder: number;
  title: string | null;
  timerSeconds: number | null;
  hasVideo: boolean;
}

const REQUIREMENT_STATE_LABELS: Record<TrainingConfigValue["requirementState"], string> = {
  disabled: "Not part of training",
  optional: "Optional",
  required: "Required",
};

const MODE_LABELS: Record<TrainingConfigValue["defaultMode"], string> = {
  learn: "Learn",
  guided: "Guided",
  test: "Test",
  demonstration: "Demonstration",
};

function toNumberField(value: number | null): string {
  return value === null ? "" : String(value);
}

export function TrainingConfigForm({
  sopId,
  initialRevision,
  initialConfig,
  steps,
  initialRequirementsByStepId,
}: {
  sopId: string;
  initialRevision: number;
  initialConfig: TrainingConfigValue;
  steps: readonly TrainingStepSummary[];
  initialRequirementsByStepId: Record<string, StepRequirementsValue>;
}) {
  const [revision, setRevision] = useState(initialRevision);
  const [config, setConfig] = useState<TrainingConfigValue>(initialConfig);
  const [passingScoreText, setPassingScoreText] = useState(
    String(initialConfig.passingScorePercent),
  );
  const [maxAttemptsText, setMaxAttemptsText] = useState(String(initialConfig.maxAttempts));
  const [qualificationValidityText, setQualificationValidityText] = useState(
    toNumberField(initialConfig.qualificationValidityDays),
  );
  const [retrainingGraceText, setRetrainingGraceText] = useState(
    toNumberField(initialConfig.retrainingGraceDays),
  );
  const [requirementsByStepId, setRequirementsByStepId] = useState(initialRequirementsByStepId);
  const [configPending, setConfigPending] = useState(false);
  const [configStatus, setConfigStatus] = useState<string>();
  const [configError, setConfigError] = useState<string>();
  const [stepPendingId, setStepPendingId] = useState<string | null>(null);
  const [stepError, setStepError] = useState<Record<string, string>>({});

  async function saveConfig() {
    setConfigPending(true);
    setConfigError(undefined);
    setConfigStatus(undefined);
    try {
      const response = await fetch(`/api/management/sops/${sopId}/training`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requirementState: config.requirementState,
          defaultMode: config.defaultMode,
          allowBacktracking: config.allowBacktracking,
          requireSequentialProgress: config.requireSequentialProgress,
          requireFullVideoWatch: config.requireFullVideoWatch,
          requireEvidenceApproval: config.requireEvidenceApproval,
          passingScorePercent: passingScoreText,
          maxAttempts: maxAttemptsText,
          qualificationValidityDays: qualificationValidityText,
          retrainingGraceDays: retrainingGraceText,
          expectedRevision: revision,
        }),
      });
      const result = (await response.json()) as ApiResult<{
        revision: number;
        config: TrainingConfigValue;
      }>;
      if (!result.ok || !result.data) {
        setConfigError(result.error?.message ?? "The training configuration could not be saved.");
        return;
      }
      setRevision(result.data.revision);
      setConfig(result.data.config);
      setPassingScoreText(String(result.data.config.passingScorePercent));
      setMaxAttemptsText(String(result.data.config.maxAttempts));
      setQualificationValidityText(toNumberField(result.data.config.qualificationValidityDays));
      setRetrainingGraceText(toNumberField(result.data.config.retrainingGraceDays));
      setConfigStatus("Training configuration saved.");
    } catch {
      setConfigError("StationSnap could not be reached. Try again.");
    } finally {
      setConfigPending(false);
    }
  }

  async function saveStepRequirements(stepId: string, values: StepRequirementsValue) {
    setStepPendingId(stepId);
    setStepError((prev) => ({ ...prev, [stepId]: "" }));
    try {
      const response = await fetch(`/api/management/sops/${sopId}/training/steps/${stepId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, expectedRevision: revision }),
      });
      const result = (await response.json()) as ApiResult<{
        revision: number;
        requirementsByStepId: Record<string, StepRequirementsValue>;
      }>;
      if (!result.ok || !result.data) {
        setStepError((prev) => ({
          ...prev,
          [stepId]: result.error?.message ?? "These requirements could not be saved.",
        }));
        return;
      }
      setRevision(result.data.revision);
      setRequirementsByStepId(result.data.requirementsByStepId);
    } catch {
      setStepError((prev) => ({
        ...prev,
        [stepId]: "StationSnap could not be reached. Try again.",
      }));
    } finally {
      setStepPendingId(null);
    }
  }

  function updateStepField(
    stepId: string,
    field: keyof StepRequirementsValue,
    checked: boolean,
  ): StepRequirementsValue {
    const current = requirementsByStepId[stepId] ?? {
      requireFullVideo: false,
      requireConfirmation: false,
      requireTimer: false,
      requireQuestion: false,
      requirePhoto: false,
      requireVideo: false,
      requireApproval: false,
    };
    const next = { ...current, [field]: checked };
    setRequirementsByStepId((prev) => ({ ...prev, [stepId]: next }));
    return next;
  }

  return (
    <div className="page-stack">
      <p className={`autosave-status${configError ? " autosave-status--error" : ""}`} role="status">
        {configPending
          ? "Saving…"
          : (configError ?? configStatus ?? "Changes are saved section by section.")}
      </p>

      <Card className="form-section">
        <h2>Training requirement</h2>
        <div className="form-grid">
          <Select
            id="training-requirement-state"
            label="Requirement"
            value={config.requirementState}
            onChange={(event) =>
              setConfig((prev) => ({
                ...prev,
                requirementState: event.target.value as TrainingConfigValue["requirementState"],
              }))
            }
          >
            {trainingRequirementStateValues.map((value) => (
              <option key={value} value={value}>
                {REQUIREMENT_STATE_LABELS[value]}
              </option>
            ))}
          </Select>
          <Select
            id="training-default-mode"
            label="Default mode"
            hint="Learn, Guided, Test, and Demonstration; used unless an assignment overrides it."
            value={config.defaultMode}
            onChange={(event) =>
              setConfig((prev) => ({
                ...prev,
                defaultMode: event.target.value as TrainingConfigValue["defaultMode"],
              }))
            }
          >
            {trainingModeValues.map((value) => (
              <option key={value} value={value}>
                {MODE_LABELS[value]}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      <Card className="form-section">
        <h2>Navigation and progression</h2>
        <Toggle
          id="training-allow-backtracking"
          label="Allow employees to revisit earlier steps"
          checked={config.allowBacktracking}
          onChange={(event) =>
            setConfig((prev) => ({ ...prev, allowBacktracking: event.target.checked }))
          }
        />
        <Toggle
          id="training-require-sequential"
          label="Require steps to be completed in order"
          checked={config.requireSequentialProgress}
          onChange={(event) =>
            setConfig((prev) => ({ ...prev, requireSequentialProgress: event.target.checked }))
          }
        />
      </Card>

      <Card className="form-section">
        <h2>Watch and approval rules</h2>
        <Toggle
          id="training-require-full-video"
          label="Require step videos to be watched in full by default"
          checked={config.requireFullVideoWatch}
          onChange={(event) =>
            setConfig((prev) => ({ ...prev, requireFullVideoWatch: event.target.checked }))
          }
        />
        <Toggle
          id="training-require-evidence-approval"
          label="Require manager approval of submitted evidence"
          checked={config.requireEvidenceApproval}
          onChange={(event) =>
            setConfig((prev) => ({ ...prev, requireEvidenceApproval: event.target.checked }))
          }
        />
      </Card>

      <Card className="form-section">
        <h2>Scoring and attempts</h2>
        <div className="form-grid">
          <Input
            id="training-passing-score"
            type="number"
            min={0}
            max={100}
            label="Passing score (%)"
            value={passingScoreText}
            onChange={(event) => setPassingScoreText(event.target.value)}
          />
          <Input
            id="training-max-attempts"
            type="number"
            min={1}
            max={20}
            label="Maximum attempts"
            value={maxAttemptsText}
            onChange={(event) => setMaxAttemptsText(event.target.value)}
          />
        </div>
      </Card>

      <Card className="form-section">
        <h2>Qualification and retraining</h2>
        <p>Only applies when the requirement above is optional or required.</p>
        <div className="form-grid">
          <Input
            id="training-qualification-validity"
            type="number"
            min={1}
            max={3650}
            label="Qualification validity (days)"
            hint="Leave blank if it never expires."
            disabled={config.requirementState === "disabled"}
            value={qualificationValidityText}
            onChange={(event) => setQualificationValidityText(event.target.value)}
          />
          <Input
            id="training-retraining-grace"
            type="number"
            min={0}
            max={365}
            label="Retraining grace period (days)"
            hint="Leave blank for no grace period."
            disabled={config.requirementState === "disabled"}
            value={retrainingGraceText}
            onChange={(event) => setRetrainingGraceText(event.target.value)}
          />
        </div>
      </Card>

      <Button type="button" disabled={configPending} onClick={saveConfig}>
        {configPending ? "Saving…" : "Save training configuration"}
      </Button>

      <Card className="form-section">
        <h2>Step requirements</h2>
        {steps.length === 0 ? (
          <p>Add steps first to configure per-step training requirements.</p>
        ) : (
          <ol className="step-list">
            {steps.map((step) => {
              const values = requirementsByStepId[step.id] ?? {
                requireFullVideo: false,
                requireConfirmation: false,
                requireTimer: false,
                requireQuestion: false,
                requirePhoto: false,
                requireVideo: false,
                requireApproval: false,
              };
              const pending = stepPendingId === step.id;
              return (
                <li key={step.id}>
                  <Card className="step-card">
                    <div className="step-card__head">
                      <span className="step-order-badge" aria-hidden="true">
                        {step.displayOrder}
                      </span>
                      <div className="step-card__title">
                        <strong>{step.title || `Step ${step.displayOrder}`}</strong>
                      </div>
                    </div>
                    <div className="checkbox-list">
                      <Toggle
                        id={`step-${step.id}-require-full-video`}
                        label="Require the step video to be fully watched"
                        checked={values.requireFullVideo}
                        disabled={!step.hasVideo}
                        onChange={(event) =>
                          updateStepField(step.id, "requireFullVideo", event.target.checked)
                        }
                      />
                      <Toggle
                        id={`step-${step.id}-require-confirmation`}
                        label="Require an explicit confirmation"
                        checked={values.requireConfirmation}
                        onChange={(event) =>
                          updateStepField(step.id, "requireConfirmation", event.target.checked)
                        }
                      />
                      <Toggle
                        id={`step-${step.id}-require-timer`}
                        label="Require the step timer to run to completion"
                        checked={values.requireTimer}
                        disabled={!step.timerSeconds}
                        onChange={(event) =>
                          updateStepField(step.id, "requireTimer", event.target.checked)
                        }
                      />
                      <Toggle
                        id={`step-${step.id}-require-question`}
                        label="Require a comprehension question"
                        checked={values.requireQuestion}
                        onChange={(event) =>
                          updateStepField(step.id, "requireQuestion", event.target.checked)
                        }
                      />
                      <Toggle
                        id={`step-${step.id}-require-photo`}
                        label="Require photo evidence"
                        checked={values.requirePhoto}
                        onChange={(event) =>
                          updateStepField(step.id, "requirePhoto", event.target.checked)
                        }
                      />
                      <Toggle
                        id={`step-${step.id}-require-video`}
                        label="Require video evidence"
                        checked={values.requireVideo}
                        onChange={(event) =>
                          updateStepField(step.id, "requireVideo", event.target.checked)
                        }
                      />
                      <Toggle
                        id={`step-${step.id}-require-approval`}
                        label="Require manager approval"
                        checked={values.requireApproval}
                        onChange={(event) =>
                          updateStepField(step.id, "requireApproval", event.target.checked)
                        }
                      />
                    </div>
                    {stepError[step.id] && (
                      <p className="form-status form-status--error" role="alert">
                        {stepError[step.id]}
                      </p>
                    )}
                    {!step.hasVideo && (
                      <p className="field__message">Add a step video before requiring it.</p>
                    )}
                    {!step.timerSeconds && (
                      <p className="field__message">Add a step timer before requiring it.</p>
                    )}
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => void saveStepRequirements(step.id, values)}
                    >
                      {pending ? "Saving…" : "Save step requirements"}
                    </Button>
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}
