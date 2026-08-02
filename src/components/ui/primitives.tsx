import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import clsx from "clsx";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  className,
  variant = "primary",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button type={type} className={clsx("button", `button--${variant}`, className)} {...props} />
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  id: string;
}

function FieldShell({ children, error, hint, id, label }: FieldProps & { children: ReactNode }) {
  const descriptionId = error || hint ? `${id}-description` : undefined;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      {(error || hint) && (
        <p
          className={clsx("field__message", error && "field__message--error")}
          id={descriptionId}
          role={error ? "alert" : undefined}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function Input({
  label,
  hint,
  error,
  id,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & FieldProps) {
  const descriptionId = error || hint ? `${id}-description` : undefined;
  return (
    <FieldShell label={label} hint={hint} error={error} id={id}>
      <input
        id={id}
        className={clsx("input", className)}
        aria-invalid={Boolean(error)}
        aria-describedby={descriptionId}
        {...props}
      />
    </FieldShell>
  );
}

export function Select({
  label,
  hint,
  error,
  id,
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & FieldProps) {
  const descriptionId = error || hint ? `${id}-description` : undefined;
  return (
    <FieldShell label={label} hint={hint} error={error} id={id}>
      <select
        id={id}
        className={clsx("input", className)}
        aria-invalid={Boolean(error)}
        aria-describedby={descriptionId}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
}

export function Textarea({
  label,
  hint,
  error,
  id,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps) {
  const descriptionId = error || hint ? `${id}-description` : undefined;
  return (
    <FieldShell label={label} hint={hint} error={error} id={id}>
      <textarea
        id={id}
        className={clsx("input", "textarea", className)}
        aria-invalid={Boolean(error)}
        aria-describedby={descriptionId}
        {...props}
      />
    </FieldShell>
  );
}

export function Checkbox({
  label,
  id,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={clsx("check-control", className)} htmlFor={id}>
      <input id={id} type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
}

export function Toggle({
  label,
  id,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={clsx("toggle", className)} htmlFor={id}>
      <input id={id} type="checkbox" role="switch" {...props} />
      <span className="toggle__track" aria-hidden="true">
        <span className="toggle__thumb" />
      </span>
      <span>{label}</span>
    </label>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={clsx("card", className)}>{children}</section>;
}

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  return <span className={clsx("badge", `badge--${tone}`)}>{children}</span>;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">StationSnap</p>
        <h1>{title}</h1>
        {description && <p className="page-header__description">{description}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}

export function ProgressIndicator({ value, label }: { value: number; label: string }) {
  const boundedValue = Math.min(100, Math.max(0, value));
  return (
    <div className="progress">
      <div className="progress__label">
        <span>{label}</span>
        <span>{boundedValue}%</span>
      </div>
      <progress max={100} value={boundedValue}>
        {boundedValue}%
      </progress>
    </div>
  );
}

export function FileUpload({
  id,
  label = "Upload a file",
  accept,
  multiple,
}: {
  id: string;
  label?: string;
  accept?: string;
  multiple?: boolean;
}) {
  return (
    <label className="file-upload" htmlFor={id}>
      <span className="file-upload__title">{label}</span>
      <span className="file-upload__hint">Choose a file or drag it here</span>
      <input id={id} type="file" accept={accept} multiple={multiple} />
    </label>
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="state-panel" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <p>{label}…</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="state-panel">
      <div className="state-panel__symbol" aria-hidden="true">
        ○
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  retry,
}: {
  title?: string;
  description: string;
  retry?: ReactNode;
}) {
  return (
    <div className="state-panel state-panel--error" role="alert">
      <div className="state-panel__symbol" aria-hidden="true">
        !
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {retry}
    </div>
  );
}
