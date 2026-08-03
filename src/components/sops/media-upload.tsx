"use client";

import { useState, type ChangeEvent } from "react";

export interface FileSummary {
  id: string;
  originalName: string;
  mimeType: string;
  mediaType: "image" | "video";
}

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

export function MediaUploadField({
  id,
  label,
  kind,
  hint,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  kind: "image" | "video";
  hint?: string;
  value: FileSummary | null;
  onChange: (file: FileSummary | null) => void;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPending(true);
    setError(undefined);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/management/media", { method: "POST", body: formData });
      const result = (await response.json()) as ApiResult<FileSummary>;
      if (!result.ok || !result.data) {
        setError(result.error?.message ?? "The upload failed.");
        return;
      }
      onChange(result.data);
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="media-field">
      <span className="field__label">{label}</span>
      {value ? (
        <div className="media-preview">
          {kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/management/media/${value.id}`} alt="" />
          ) : (
            <video src={`/api/management/media/${value.id}`} muted />
          )}
          <div className="media-preview__meta">
            <small>{value.originalName}</small>
            {!disabled && (
              <button type="button" className="button button--ghost" onClick={() => onChange(null)}>
                Remove
              </button>
            )}
          </div>
        </div>
      ) : (
        <label className={`file-upload${disabled ? " file-upload--disabled" : ""}`} htmlFor={id}>
          <span className="file-upload__title">{pending ? "Uploading…" : label}</span>
          <span className="file-upload__hint">{hint ?? "Choose a file or drag it here"}</span>
          <input
            id={id}
            type="file"
            accept={kind === "image" ? "image/*" : "video/*"}
            onChange={handleChange}
            disabled={pending || disabled}
          />
        </label>
      )}
      {error && (
        <p className="field__message field__message--error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
