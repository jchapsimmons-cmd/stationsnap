"use client";

import { useState } from "react";
import { Button, Card, StatusBadge, Textarea } from "@/components/ui";

export interface TranslationMatrixRowData {
  translationId: string | null;
  entityType: "sop_version" | "sop_material" | "sop_warning" | "sop_step";
  entityId: string;
  field: "title" | "description" | "name" | "text" | "instruction" | "warning";
  contextLabel: string;
  sourceText: string;
  translatedText: string;
  status: "untranslated" | "pending_review" | "approved";
  stale: boolean;
  approvedAt: string | null;
}

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

interface MatrixResponse {
  sopId: string;
  versionNumber: number;
  targetLocale: string;
  rows: TranslationMatrixRowData[];
}

function rowKey(row: TranslationMatrixRowData): string {
  return `${row.entityType}:${row.entityId}:${row.field}`;
}

function statusBadge(row: TranslationMatrixRowData) {
  if (row.status === "approved" && row.stale) {
    return <StatusBadge tone="warning">Needs re-review</StatusBadge>;
  }
  if (row.status === "approved") return <StatusBadge tone="success">Approved</StatusBadge>;
  if (row.status === "pending_review") return <StatusBadge tone="info">Pending review</StatusBadge>;
  return <StatusBadge tone="neutral">Untranslated</StatusBadge>;
}

export function TranslationEditor({
  sopId,
  targetLocale,
  initialRows,
}: {
  sopId: string;
  targetLocale: string;
  initialRows: readonly TranslationMatrixRowData[];
}) {
  const [rows, setRows] = useState<TranslationMatrixRowData[]>([...initialRows]);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialRows.map((row) => [rowKey(row), row.translatedText])),
  );
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  function applyResult(result: ApiResult<MatrixResponse>): boolean {
    if (!result.ok || !result.data) {
      setError(result.error?.message ?? "That action could not be completed.");
      return false;
    }
    setRows(result.data.rows);
    setDrafts(Object.fromEntries(result.data.rows.map((row) => [rowKey(row), row.translatedText])));
    setError(undefined);
    return true;
  }

  async function save(row: TranslationMatrixRowData) {
    const key = rowKey(row);
    setPendingKey(key);
    setError(undefined);
    try {
      const response = await fetch(`/api/management/sops/${sopId}/translations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entityType: row.entityType,
          entityId: row.entityId,
          field: row.field,
          targetLocale,
          translatedText: drafts[key] ?? "",
        }),
      });
      applyResult((await response.json()) as ApiResult<MatrixResponse>);
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPendingKey(null);
    }
  }

  async function approve(row: TranslationMatrixRowData) {
    if (!row.translationId) return;
    const key = rowKey(row);
    setPendingKey(key);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/management/sops/${sopId}/translations/${row.translationId}/approve`,
        { method: "POST" },
      );
      applyResult((await response.json()) as ApiResult<MatrixResponse>);
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div className="page-stack">
      {error && (
        <p role="alert" className="form-status form-status--error">
          {error}
        </p>
      )}
      {rows.length === 0 && (
        <Card>
          <p>There is no translatable content on the current published version yet.</p>
        </Card>
      )}
      {rows.map((row) => {
        const key = rowKey(row);
        const draft = drafts[key] ?? "";
        const isPending = pendingKey === key;
        const canApprove = row.translationId !== null && draft.trim().length > 0 && !row.stale;
        return (
          <Card key={key}>
            <div className="action-row">
              <p className="eyebrow">{row.contextLabel}</p>
              {statusBadge(row)}
            </div>
            <p>{row.sourceText}</p>
            <Textarea
              id={`translation-${key}`}
              label="Spanish translation"
              rows={3}
              value={draft}
              onChange={(event) =>
                setDrafts((previous) => ({ ...previous, [key]: event.target.value }))
              }
            />
            {row.stale && (
              <p role="alert" className="form-status form-status--error">
                The English text changed since this translation was entered. Review and save it
                again before approving.
              </p>
            )}
            <div className="action-row">
              <Button
                type="button"
                variant="secondary"
                disabled={isPending}
                onClick={() => save(row)}
              >
                Save translation
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={isPending || !canApprove}
                onClick={() => approve(row)}
              >
                Approve
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
