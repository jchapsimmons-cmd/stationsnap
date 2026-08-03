"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button, Input } from "@/components/ui/primitives";

interface ApiBody<T> {
  ok: boolean;
  data?: T;
  error?: { message: string; details?: { fields?: Record<string, string[]> } };
}

async function postJson<T>(url: string, data: Record<string, string>): Promise<ApiBody<T>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  return (await response.json()) as ApiBody<T>;
}

function FormStatus({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) return null;
  return (
    <p
      className={`auth-form__status ${error ? "auth-form__status--error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {error ?? success}
    </p>
  );
}

export function ManagerLoginForm({ returnTo }: { returnTo: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const body = await postJson<{ redirectTo: string }>("/api/auth/manager/login", {
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
        returnTo,
      });
      if (!body.ok || !body.data) return setError(body.error?.message ?? "Sign-in failed.");
      window.location.assign(body.data.redirectTo);
    } catch {
      setError("We couldn’t reach StationSnap. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="auth-form" onSubmit={submit}>
      <Input
        id="manager-email"
        name="email"
        type="email"
        label="Email address"
        autoComplete="email"
        required
      />
      <Input
        id="manager-password"
        name="password"
        type="password"
        label="Password"
        autoComplete="current-password"
        minLength={12}
        required
      />
      <FormStatus error={error} />
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <Link className="auth-form__link" href="/manager/recover">
        Forgot your password?
      </Link>
    </form>
  );
}

export function PasswordResetRequestForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const body = await postJson<{ message: string }>("/api/auth/manager/password-reset/request", {
        email: String(form.get("email") ?? ""),
      });
      if (!body.ok || !body.data) return setError(body.error?.message ?? "Reset request failed.");
      setSuccess(body.data.message);
    } catch {
      setError("We couldn’t reach StationSnap. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="auth-form" onSubmit={submit}>
      <Input
        id="reset-email"
        name="email"
        type="email"
        label="Email address"
        autoComplete="email"
        required
      />
      <FormStatus error={error} success={success} />
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}

export function PasswordResetConfirmForm({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const body = await postJson<{ redirectTo: string }>(
        "/api/auth/manager/password-reset/confirm",
        {
          token,
          password: String(form.get("password") ?? ""),
          passwordConfirmation: String(form.get("passwordConfirmation") ?? ""),
        },
      );
      if (!body.ok || !body.data) return setError(body.error?.message ?? "Password reset failed.");
      window.location.assign(body.data.redirectTo);
    } catch {
      setError("We couldn’t reach StationSnap. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="auth-form" onSubmit={submit}>
      <Input
        id="new-password"
        name="password"
        type="password"
        label="New password"
        hint="Use at least 12 characters."
        autoComplete="new-password"
        minLength={12}
        required
      />
      <Input
        id="confirm-password"
        name="passwordConfirmation"
        type="password"
        label="Confirm new password"
        autoComplete="new-password"
        minLength={12}
        required
      />
      <FormStatus error={error} />
      <Button type="submit" disabled={pending || !token}>
        {pending ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}

export function EmployeeAccessForm({ returnTo }: { returnTo: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const body = await postJson<{ redirectTo: string }>("/api/auth/employee/access", {
        organizationSlug: String(form.get("organizationSlug") ?? ""),
        locationSlug: String(form.get("locationSlug") ?? ""),
        returnTo,
      });
      if (!body.ok || !body.data) return setError(body.error?.message ?? "Location not found.");
      window.location.assign(body.data.redirectTo);
    } catch {
      setError("We couldn’t reach StationSnap. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="auth-form" onSubmit={submit}>
      <Input
        id="organization-code"
        name="organizationSlug"
        label="Restaurant code"
        autoComplete="organization"
        pattern="[a-zA-Z0-9-]{2,64}"
        required
      />
      <Input
        id="location-code"
        name="locationSlug"
        label="Location code"
        pattern="[a-zA-Z0-9-]{2,64}"
        required
      />
      <FormStatus error={error} />
      <Button type="submit" disabled={pending}>
        {pending ? "Checking…" : "Continue"}
      </Button>
    </form>
  );
}

export function EmployeeLoginForm({
  organizationSlug,
  locationSlug,
  returnTo,
}: {
  organizationSlug: string;
  locationSlug: string;
  returnTo: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const body = await postJson<{ redirectTo: string }>("/api/auth/employee/login", {
        organizationSlug,
        locationSlug,
        employeeNumber: String(form.get("employeeNumber") ?? ""),
        pin: String(form.get("pin") ?? ""),
        returnTo,
      });
      if (!body.ok || !body.data) return setError(body.error?.message ?? "Sign-in failed.");
      window.location.assign(body.data.redirectTo);
    } catch {
      setError("We couldn’t reach StationSnap. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="auth-form" onSubmit={submit}>
      <Input
        id="employee-number"
        name="employeeNumber"
        label="Employee number"
        autoComplete="username"
        inputMode="numeric"
        required
      />
      <Input
        id="employee-pin"
        name="pin"
        type="password"
        label="Four-digit PIN"
        autoComplete="current-password"
        inputMode="numeric"
        pattern="[0-9]{4}"
        maxLength={4}
        required
      />
      <FormStatus error={error} />
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Open StationSnap"}
      </Button>
    </form>
  );
}
