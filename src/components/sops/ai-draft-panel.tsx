"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, StatusBadge } from "@/components/ui";
import { MediaUploadField, type FileSummary } from "@/components/sops/media-upload";

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

type AiJobStatus = "upload_received" | "transcribing" | "drafting" | "ready" | "failed";

interface AiDraftMaterial {
  kind: "material" | "ingredient";
  name: string;
  quantity: string;
  unit: string;
}

interface AiDraftWarning {
  text: string;
}

interface AiDraftStep {
  title: string;
  instruction: string;
  warning: string;
  quantity: string;
  unit: string;
  equipmentSetting: string;
  timerSeconds: number | null;
}

interface AiDraftStructure {
  title: string;
  description: string;
  materials: AiDraftMaterial[];
  warnings: AiDraftWarning[];
  steps: AiDraftStep[];
}

interface AiJobRow {
  id: string;
  status: AiJobStatus;
  failedStep: "transcribing" | "drafting" | null;
  stepAttempts: number;
  maxStepAttempts: number;
  lastErrorMessage: string;
  transcript: string;
  createdAt: string;
  readyAt: string | null;
}

interface AiJobOutputRow {
  id: string;
  jobId: string;
  schemaVersion: number;
  structuredDraft: AiDraftStructure;
  acceptanceState: "pending" | "applied" | "dismissed";
  createdAt: string;
}

interface JobWithOutputs {
  job: AiJobRow;
  outputs: AiJobOutputRow[];
}

const IN_PROGRESS_STATUSES: readonly AiJobStatus[] = [
  "upload_received",
  "transcribing",
  "drafting",
];

function statusTone(status: AiJobStatus): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "ready") return "success";
  if (status === "failed") return "danger";
  return "info";
}

function statusLabel(status: AiJobStatus): string {
  switch (status) {
    case "upload_received":
      return "Queued";
    case "transcribing":
      return "Transcribing";
    case "drafting":
      return "Drafting";
    case "ready":
      return "Ready for review";
    case "failed":
      return "Failed";
  }
}

export function AiDraftPanel({
  sopId,
  stepsHref,
  initialJobs,
}: {
  sopId: string;
  stepsHref: string;
  initialJobs: readonly JobWithOutputs[];
}) {
  const [jobs, setJobs] = useState<JobWithOutputs[]>([...initialJobs]);
  const [video, setVideo] = useState<FileSummary | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/management/sops/${sopId}/ai`);
      const result = (await response.json()) as ApiResult<JobWithOutputs[]>;
      if (result.ok && result.data) setJobs(result.data);
    } catch {
      // Best-effort background refresh; a manual retry/apply action still reports its own errors.
    }
  }, [sopId]);

  useEffect(() => {
    const hasActiveJob = jobs.some((entry) => IN_PROGRESS_STATUSES.includes(entry.job.status));
    if (!hasActiveJob) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(refresh, 8_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [jobs, refresh]);

  async function startJob() {
    if (!video) return;
    setPendingAction("create");
    setError(undefined);
    try {
      const response = await fetch(`/api/management/sops/${sopId}/ai`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceFileId: video.id }),
      });
      const result = (await response.json()) as ApiResult<JobWithOutputs>;
      if (!result.ok || !result.data) {
        setError(result.error?.message ?? "Could not start the AI draft job.");
        return;
      }
      setJobs((current) => [result.data as JobWithOutputs, ...current]);
      setVideo(null);
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPendingAction(null);
    }
  }

  async function runAction(jobId: string, action: "retry" | "regenerate", key: string) {
    setPendingAction(key);
    setError(undefined);
    try {
      const response = await fetch(`/api/management/sops/${sopId}/ai/${jobId}/${action}`, {
        method: "POST",
      });
      const result = (await response.json()) as ApiResult<JobWithOutputs>;
      if (!result.ok || !result.data) {
        setError(result.error?.message ?? "That action could not be completed.");
        return;
      }
      setJobs((current) =>
        current.map((entry) => (entry.job.id === jobId ? (result.data as JobWithOutputs) : entry)),
      );
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPendingAction(null);
    }
  }

  async function decideOutput(jobId: string, outputId: string, decision: "apply" | "dismiss") {
    const key = `${decision}:${outputId}`;
    setPendingAction(key);
    setError(undefined);
    try {
      const response = await fetch(`/api/management/sops/${sopId}/ai/${jobId}/${decision}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outputId }),
      });
      const result = (await response.json()) as ApiResult<JobWithOutputs>;
      if (!result.ok || !result.data) {
        setError(result.error?.message ?? "That action could not be completed.");
        return;
      }
      setJobs((current) =>
        current.map((entry) => (entry.job.id === jobId ? (result.data as JobWithOutputs) : entry)),
      );
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="page-stack">
      {error && (
        <p role="alert" className="form-status form-status--error">
          {error}
        </p>
      )}
      <Card>
        <h2>Generate a draft from a video</h2>
        <p>
          Upload a training video and StationSnap will transcribe it and draft a title, description,
          materials, warnings, and steps for you to review. The AI draft never publishes anything —
          it only ever produces an editable draft you approve, edit, and publish yourself from the
          normal step editor.
        </p>
        <MediaUploadField
          id="ai-draft-video"
          label="Upload a video"
          kind="video"
          value={video}
          onChange={setVideo}
        />
        <Button onClick={startJob} disabled={!video || pendingAction === "create"}>
          {pendingAction === "create" ? "Starting…" : "Generate draft"}
        </Button>
      </Card>

      {jobs.length === 0 ? (
        <Card>
          <p>No AI draft jobs yet. Upload a video above to start one.</p>
        </Card>
      ) : (
        jobs.map(({ job, outputs }) => {
          const pendingOutput = outputs.find((output) => output.acceptanceState === "pending");
          return (
            <Card key={job.id}>
              <div className="action-row" style={{ justifyContent: "space-between" }}>
                <div>
                  <p className="eyebrow">Started {new Date(job.createdAt).toLocaleString()}</p>
                  <StatusBadge tone={statusTone(job.status)}>{statusLabel(job.status)}</StatusBadge>
                </div>
                <div className="action-row">
                  {job.status === "failed" && (
                    <Button
                      variant="secondary"
                      onClick={() => runAction(job.id, "retry", `retry:${job.id}`)}
                      disabled={pendingAction === `retry:${job.id}`}
                    >
                      {pendingAction === `retry:${job.id}` ? "Retrying…" : "Retry"}
                    </Button>
                  )}
                  {(job.status === "ready" || job.status === "failed") && job.transcript && (
                    <Button
                      variant="secondary"
                      onClick={() => runAction(job.id, "regenerate", `regenerate:${job.id}`)}
                      disabled={pendingAction === `regenerate:${job.id}`}
                    >
                      {pendingAction === `regenerate:${job.id}`
                        ? "Regenerating…"
                        : "Regenerate draft"}
                    </Button>
                  )}
                </div>
              </div>

              {IN_PROGRESS_STATUSES.includes(job.status) && (
                <p>
                  {job.status === "upload_received" && "Waiting for the next processing cycle…"}
                  {job.status === "transcribing" && "Transcribing the video…"}
                  {job.status === "drafting" && "Drafting the SOP structure…"}
                  {job.stepAttempts > 0 &&
                    ` (attempt ${job.stepAttempts + 1} of ${job.maxStepAttempts})`}
                </p>
              )}

              {job.status === "failed" && (
                <div>
                  <p className="field__message field__message--error" role="alert">
                    {job.lastErrorMessage || "This job failed."}
                    {job.failedStep
                      ? ` (failed while ${job.failedStep === "transcribing" ? "transcribing" : "drafting"})`
                      : ""}
                  </p>
                  <p>
                    You can retry the AI draft, or{" "}
                    <Link href={stepsHref}>continue editing this SOP manually</Link> instead.
                  </p>
                </div>
              )}

              {pendingOutput && (
                <div className="detail-grid">
                  <h3>Generated draft</h3>
                  <p>
                    <strong>Title:</strong> {pendingOutput.structuredDraft.title}
                  </p>
                  {pendingOutput.structuredDraft.description && (
                    <p>
                      <strong>Description:</strong> {pendingOutput.structuredDraft.description}
                    </p>
                  )}
                  <p>
                    {pendingOutput.structuredDraft.materials.length} material(s) ·{" "}
                    {pendingOutput.structuredDraft.warnings.length} warning(s) ·{" "}
                    {pendingOutput.structuredDraft.steps.length} step(s)
                  </p>
                  <ol>
                    {pendingOutput.structuredDraft.steps.map((step, index) => (
                      <li key={index}>
                        {step.title ? `${step.title}: ` : ""}
                        {step.instruction}
                      </li>
                    ))}
                  </ol>
                  <div className="action-row">
                    <Button
                      onClick={() => decideOutput(job.id, pendingOutput.id, "apply")}
                      disabled={pendingAction === `apply:${pendingOutput.id}`}
                    >
                      {pendingAction === `apply:${pendingOutput.id}`
                        ? "Applying…"
                        : "Apply to draft"}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => decideOutput(job.id, pendingOutput.id, "dismiss")}
                      disabled={pendingAction === `dismiss:${pendingOutput.id}`}
                    >
                      {pendingAction === `dismiss:${pendingOutput.id}` ? "Dismissing…" : "Dismiss"}
                    </Button>
                  </div>
                </div>
              )}

              {outputs.some((output) => output.acceptanceState === "applied") && (
                <p>
                  <StatusBadge tone="success">Applied to draft</StatusBadge> —{" "}
                  <Link href={stepsHref}>review the steps</Link> before publishing.
                </p>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
