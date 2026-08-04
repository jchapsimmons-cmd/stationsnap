"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, StatusBadge } from "@/components/ui";

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

interface StepRequirements {
  requireFullVideo: boolean;
  requireConfirmation: boolean;
  requireTimer: boolean;
  requireQuestion: boolean;
  requirePhoto: boolean;
  requireVideo: boolean;
  requireApproval: boolean;
}

interface QuestionChoice {
  id: string;
  text: string;
  displayOrder: number;
  isCorrect?: boolean;
}

interface QuestionAnswer {
  selectedChoiceIds: string[];
  isCorrect: boolean;
  pointsAwarded: number;
  explanation: string | null;
}

interface Question {
  id: string;
  stepId: string | null;
  type: "single_choice" | "multiple_choice" | "true_false";
  text: string;
  points: number;
  placement: "before_step" | "after_step" | "final";
  displayOrder: number;
  choices: QuestionChoice[];
  answer: QuestionAnswer | null;
}

interface StepEvidence {
  id: string;
  evidenceType: "photo" | "video";
  status: "pending" | "approved" | "rejected";
  submissionGeneration: number;
  fileId: string;
  createdAt: string;
}

interface StepPayload {
  id: string;
  displayOrder: number;
  title: string | null;
  instruction: string;
  imageFileId: string | null;
  videoFileId: string | null;
  warning: string | null;
  quantity: string | null;
  unit: string | null;
  equipmentSetting: string | null;
  timerSeconds: number | null;
  isRequired: boolean;
  requirements: StepRequirements;
  progress: {
    status: "pending" | "in_progress" | "completed";
    confirmed: boolean;
    videoWatchedFully: boolean;
    timerCompleted: boolean;
  };
  evidence: StepEvidence[];
  beforeQuestions: Question[];
  afterQuestions: Question[];
}

export interface SessionState {
  id: string;
  assignmentId: string;
  attemptNumber: number;
  mode: string;
  status: "in_progress" | "awaiting_approval" | "passed" | "failed";
  currentStepId: string | null;
  scorePercent: number | null;
  revision: number;
  allRequiredStepsDone: boolean;
  finalQuestionsAnswered: boolean;
  steps: StepPayload[];
  finalQuestions: Question[];
}

function QuestionCard({
  question,
  disabled,
  onSubmit,
}: {
  question: Question;
  disabled: boolean;
  onSubmit: (selectedChoiceIds: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>(question.answer?.selectedChoiceIds ?? []);
  const [pending, setPending] = useState(false);
  const isMultiple = question.type === "multiple_choice";

  function toggle(choiceId: string) {
    if (isMultiple) {
      setSelected((prev) =>
        prev.includes(choiceId) ? prev.filter((id) => id !== choiceId) : [...prev, choiceId],
      );
    } else {
      setSelected([choiceId]);
    }
  }

  return (
    <Card className="step-card">
      <p>{question.text}</p>
      <div className="checkbox-list">
        {question.choices.map((choice) => (
          <label key={choice.id} className="check-control">
            <input
              type={isMultiple ? "checkbox" : "radio"}
              name={`question-${question.id}`}
              checked={selected.includes(choice.id)}
              disabled={disabled}
              onChange={() => toggle(choice.id)}
            />
            <span>{choice.text}</span>
          </label>
        ))}
      </div>
      {question.answer && (
        <p role="status">
          {question.answer.isCorrect ? "Correct." : "Incorrect."}
          {question.answer.explanation ? ` ${question.answer.explanation}` : ""}
        </p>
      )}
      <Button
        type="button"
        variant="secondary"
        disabled={disabled || pending || selected.length === 0}
        onClick={() => {
          setPending(true);
          void onSubmit(selected).finally(() => setPending(false));
        }}
      >
        {pending ? "Submitting…" : question.answer ? "Update answer" : "Submit answer"}
      </Button>
    </Card>
  );
}

export function TrainingSessionRunner({
  assignmentId,
  sessionId,
  initialState,
}: {
  assignmentId: string;
  sessionId: string;
  initialState: SessionState;
}) {
  const router = useRouter();
  const [state, setState] = useState<SessionState>(initialState);
  const [focusedStepId, setFocusedStepId] = useState<string | null>(
    initialState.currentStepId ?? initialState.steps[0]?.id ?? null,
  );
  const [error, setError] = useState<string>();
  const [submitPending, setSubmitPending] = useState(false);
  const [timerRemaining, setTimerRemaining] = useState<Record<string, number>>({});

  const basePath = `/api/employee/training/assignments/${assignmentId}/session/${sessionId}`;

  const focusedStep = useMemo(
    () => state.steps.find((step) => step.id === focusedStepId) ?? null,
    [state.steps, focusedStepId],
  );

  async function applyResult(promise: Promise<Response>) {
    setError(undefined);
    try {
      const response = await promise;
      const result = (await response.json()) as ApiResult<SessionState>;
      if (!result.ok || !result.data) {
        setError(result.error?.message ?? "That action could not be completed.");
        return;
      }
      setState(result.data);
      if (result.data.currentStepId) setFocusedStepId(result.data.currentStepId);
    } catch {
      setError("StationSnap could not be reached. Try again.");
    }
  }

  async function recordAction(stepId: string, action: string) {
    await applyResult(
      fetch(`${basePath}/steps/${stepId}/action`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, expectedRevision: state.revision }),
      }),
    );
  }

  async function submitAnswer(questionId: string, selectedChoiceIds: string[]) {
    await applyResult(
      fetch(`${basePath}/answers/${questionId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selectedChoiceIds, expectedRevision: state.revision }),
      }),
    );
  }

  async function uploadEvidence(stepId: string, file: File) {
    const formData = new FormData();
    formData.set("file", file);
    formData.set("employeeNote", "");
    formData.set("expectedRevision", String(state.revision));
    await applyResult(
      fetch(`${basePath}/steps/${stepId}/evidence`, { method: "POST", body: formData }),
    );
  }

  function startTimer(stepId: string, seconds: number) {
    setTimerRemaining((prev) => ({ ...prev, [stepId]: seconds }));
    const interval = setInterval(() => {
      setTimerRemaining((prev) => {
        const remaining = (prev[stepId] ?? 0) - 1;
        if (remaining <= 0) {
          clearInterval(interval);
          void recordAction(stepId, "timer_completed");
          return { ...prev, [stepId]: 0 };
        }
        return { ...prev, [stepId]: remaining };
      });
    }, 1000);
  }

  async function submitSession() {
    setSubmitPending(true);
    try {
      const response = await fetch(`${basePath}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: state.revision }),
      });
      const result = (await response.json()) as ApiResult<SessionState>;
      if (!result.ok || !result.data) {
        setError(result.error?.message ?? "This attempt could not be submitted.");
        return;
      }
      setState(result.data);
      router.push(`/employee/training/${assignmentId}/result`);
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setSubmitPending(false);
    }
  }

  if (state.status !== "in_progress") {
    return (
      <Card>
        <p role="status">This attempt has already been submitted.</p>
      </Card>
    );
  }

  const readyToSubmit = state.allRequiredStepsDone && state.finalQuestionsAnswered;

  return (
    <div className="page-stack">
      {error && (
        <p className="form-status form-status--error" role="alert">
          {error}
        </p>
      )}

      <div className="action-row">
        {state.steps.map((step) => (
          <button
            key={step.id}
            type="button"
            className={`badge badge--${
              step.progress.status === "completed"
                ? "success"
                : step.id === focusedStepId
                  ? "info"
                  : "neutral"
            }`}
            onClick={() => setFocusedStepId(step.id)}
            aria-current={step.id === focusedStepId ? "step" : undefined}
          >
            Step {step.displayOrder}
          </button>
        ))}
      </div>

      {focusedStep && (
        <Card className="step-card">
          <p className="eyebrow">Step {focusedStep.displayOrder}</p>
          {focusedStep.title && <h2>{focusedStep.title}</h2>}
          <p>{focusedStep.instruction}</p>
          {focusedStep.imageFileId && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/employee/media/${focusedStep.imageFileId}`} alt="" />
          )}
          {focusedStep.videoFileId && (
            <video
              src={`/api/employee/media/${focusedStep.videoFileId}`}
              controls
              onEnded={() => {
                if (focusedStep.requirements.requireFullVideo) {
                  void recordAction(focusedStep.id, "video_watched");
                }
              }}
            />
          )}
          {focusedStep.warning && (
            <p role="alert" className="form-status form-status--error">
              {focusedStep.warning}
            </p>
          )}

          {focusedStep.beforeQuestions.map((question) => (
            <QuestionCard
              key={question.id}
              question={question}
              disabled={false}
              onSubmit={(choices) => submitAnswer(question.id, choices)}
            />
          ))}

          {focusedStep.requirements.requireConfirmation && (
            <Button
              type="button"
              variant={focusedStep.progress.confirmed ? "secondary" : "primary"}
              disabled={focusedStep.progress.confirmed}
              onClick={() => void recordAction(focusedStep.id, "confirmed")}
            >
              {focusedStep.progress.confirmed ? "Confirmed" : "Confirm this step"}
            </Button>
          )}

          {focusedStep.requirements.requireTimer && focusedStep.timerSeconds && (
            <div className="timer">
              {focusedStep.progress.timerCompleted ? (
                <StatusBadge tone="success">Timer complete</StatusBadge>
              ) : timerRemaining[focusedStep.id] != null ? (
                <p>{timerRemaining[focusedStep.id]}s remaining</p>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => startTimer(focusedStep.id, focusedStep.timerSeconds ?? 0)}
                >
                  Start {focusedStep.timerSeconds}s timer
                </Button>
              )}
            </div>
          )}

          {(focusedStep.requirements.requirePhoto || focusedStep.requirements.requireVideo) && (
            <div className="field">
              <label className="field__label" htmlFor={`evidence-${focusedStep.id}`}>
                Upload{" "}
                {focusedStep.requirements.requirePhoto && focusedStep.requirements.requireVideo
                  ? "a photo or video"
                  : focusedStep.requirements.requirePhoto
                    ? "a photo"
                    : "a video"}{" "}
                as proof
              </label>
              <input
                id={`evidence-${focusedStep.id}`}
                type="file"
                accept="image/*,video/*"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadEvidence(focusedStep.id, file);
                }}
              />
              {focusedStep.evidence.length > 0 && (
                <p className="field__message">
                  {focusedStep.evidence.length} submission
                  {focusedStep.evidence.length === 1 ? "" : "s"} uploaded.
                </p>
              )}
            </div>
          )}

          {focusedStep.afterQuestions.map((question) => (
            <QuestionCard
              key={question.id}
              question={question}
              disabled={false}
              onSubmit={(choices) => submitAnswer(question.id, choices)}
            />
          ))}
        </Card>
      )}

      {state.allRequiredStepsDone && state.finalQuestions.length > 0 && (
        <Card className="step-card">
          <h2>Final questions</h2>
          {state.finalQuestions.map((question) => (
            <QuestionCard
              key={question.id}
              question={question}
              disabled={false}
              onSubmit={(choices) => submitAnswer(question.id, choices)}
            />
          ))}
        </Card>
      )}

      <Button
        type="button"
        disabled={!readyToSubmit || submitPending}
        onClick={() => void submitSession()}
      >
        {submitPending ? "Submitting…" : "Submit training"}
      </Button>
    </div>
  );
}
