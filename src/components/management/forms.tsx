"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Card, Checkbox, Input, Select, Textarea } from "@/components/ui";

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string; details?: { fields?: Record<string, string[]> } };
}

async function save<T>(url: string, method: "POST" | "PATCH", payload: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await response.json()) as ApiResult<T>;
}

function FormStatus({ message, error }: { message?: string; error?: string }) {
  if (!message && !error) return null;
  return (
    <p
      className={`form-status ${error ? "form-status--error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {error ?? message}
    </p>
  );
}

function value(form: FormData, name: string): string {
  return String(form.get(name) ?? "");
}

const statusOptions = (
  <>
    <option value="active">Active</option>
    <option value="disabled">Disabled</option>
  </>
);

export function OrganizationForm({
  organization,
  canEdit,
}: {
  organization: {
    name: string;
    logoUrl: string | null;
    defaultLanguage: "en" | "es";
    timezone: string;
    status: "active" | "disabled";
  };
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setPending(true);
    setError(undefined);
    setMessage(undefined);
    const form = new FormData(formElement);
    try {
      const result = await save("/api/management/organization", "PATCH", {
        name: value(form, "name"),
        logoUrl: value(form, "logoUrl"),
        defaultLanguage: value(form, "defaultLanguage"),
        timezone: value(form, "timezone"),
        status: value(form, "status"),
      });
      if (!result.ok) return setError(result.error?.message ?? "Organization could not be saved.");
      setMessage("Organization settings saved.");
      router.refresh();
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="management-form" onSubmit={submit}>
      <Card className="form-section">
        <h2>Organization profile</h2>
        <Input
          id="organization-name"
          name="name"
          label="Organization name"
          defaultValue={organization.name}
          maxLength={120}
          required
          disabled={!canEdit}
        />
        <Input
          id="organization-logo"
          name="logoUrl"
          type="url"
          label="Logo URL"
          hint="Use a publicly accessible HTTPS image URL."
          defaultValue={organization.logoUrl ?? ""}
          disabled={!canEdit}
        />
        <div className="form-grid">
          <Select
            id="organization-language"
            name="defaultLanguage"
            label="Default language"
            defaultValue={organization.defaultLanguage}
            disabled={!canEdit}
          >
            <option value="en">English</option>
            <option value="es">Spanish</option>
          </Select>
          <Input
            id="organization-timezone"
            name="timezone"
            label="Timezone"
            hint="For example, America/Chicago"
            defaultValue={organization.timezone}
            required
            disabled={!canEdit}
          />
          <Select
            id="organization-status"
            name="status"
            label="Status"
            defaultValue={organization.status}
            disabled={!canEdit}
          >
            {statusOptions}
          </Select>
        </div>
      </Card>
      <FormStatus message={message} error={error} />
      {canEdit && (
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save organization"}
        </Button>
      )}
    </form>
  );
}

export function LocationForm({
  location,
}: {
  location?: {
    id: string;
    name: string;
    accessSlug: string;
    timezone: string;
    status: "active" | "disabled";
  };
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const result = await save<{ id: string }>(
        location ? `/api/management/locations/${location.id}` : "/api/management/locations",
        location ? "PATCH" : "POST",
        {
          name: value(form, "name"),
          accessSlug: value(form, "accessSlug"),
          timezone: value(form, "timezone"),
          status: value(form, "status"),
        },
      );
      if (!result.ok || !result.data)
        return setError(result.error?.message ?? "Location could not be saved.");
      router.push(`/manager/settings/locations/${result.data.id}`);
      router.refresh();
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="management-form" onSubmit={submit}>
      <Card className="form-section">
        <h2>Location details</h2>
        <div className="form-grid">
          <Input
            id="location-name"
            name="name"
            label="Location name"
            defaultValue={location?.name}
            maxLength={120}
            required
          />
          <Input
            id="location-slug"
            name="accessSlug"
            label="Employee access code"
            hint="Lowercase letters, numbers, and hyphens."
            defaultValue={location?.accessSlug}
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            required
          />
          <Input
            id="location-timezone"
            name="timezone"
            label="Timezone"
            defaultValue={location?.timezone ?? "America/Chicago"}
            required
          />
          <Select
            id="location-status"
            name="status"
            label="Status"
            defaultValue={location?.status ?? "active"}
          >
            {statusOptions}
          </Select>
        </div>
      </Card>
      <FormStatus error={error} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : location ? "Save location" : "Create location"}
      </Button>
    </form>
  );
}

interface LocationOption {
  id: string;
  name: string;
}

export function StationForm({
  station,
  locations,
}: {
  station?: {
    id: string;
    locationId: string;
    name: string;
    description: string;
    imageUrl: string | null;
    displayOrder: number;
    status: "active" | "disabled";
  };
  locations: readonly LocationOption[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const result = await save<{ id: string }>(
        station ? `/api/management/stations/${station.id}` : "/api/management/stations",
        station ? "PATCH" : "POST",
        {
          locationId: value(form, "locationId"),
          name: value(form, "name"),
          description: value(form, "description"),
          imageUrl: value(form, "imageUrl"),
          displayOrder: value(form, "displayOrder"),
          status: value(form, "status"),
        },
      );
      if (!result.ok || !result.data)
        return setError(result.error?.message ?? "Station could not be saved.");
      router.push(`/manager/settings/stations/${result.data.id}`);
      router.refresh();
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="management-form" onSubmit={submit}>
      <Card className="form-section">
        <h2>Station details</h2>
        <div className="form-grid">
          <Select
            id="station-location"
            name="locationId"
            label="Location"
            defaultValue={station?.locationId}
            required
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
          <Input
            id="station-name"
            name="name"
            label="Station name"
            defaultValue={station?.name}
            required
          />
          <Input
            id="station-order"
            name="displayOrder"
            type="number"
            min={1}
            max={10000}
            label="Display order"
            defaultValue={station?.displayOrder ?? 1}
            required
          />
          <Select
            id="station-status"
            name="status"
            label="Status"
            defaultValue={station?.status ?? "active"}
          >
            {statusOptions}
          </Select>
        </div>
        <Textarea
          id="station-description"
          name="description"
          label="Description"
          defaultValue={station?.description}
          maxLength={2000}
        />
        <Input
          id="station-image"
          name="imageUrl"
          type="url"
          label="Station image URL"
          hint="Use a publicly accessible HTTPS image URL."
          defaultValue={station?.imageUrl ?? ""}
        />
      </Card>
      <FormStatus error={error} />
      <Button type="submit" disabled={pending || locations.length === 0}>
        {pending ? "Saving…" : station ? "Save station" : "Create station"}
      </Button>
    </form>
  );
}

export function EmployeeForm({
  employee,
  locations,
}: {
  employee?: {
    id: string;
    primaryLocationId: string;
    employeeNumber: string;
    displayName: string;
    jobRole: string;
    language: "en" | "es";
    status: "active" | "disabled";
  };
  locations: readonly LocationOption[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    const payload: Record<string, string> = {
      primaryLocationId: value(form, "primaryLocationId"),
      employeeNumber: value(form, "employeeNumber"),
      displayName: value(form, "displayName"),
      jobRole: value(form, "jobRole"),
      language: value(form, "language"),
      status: value(form, "status"),
    };
    if (!employee) payload["pin"] = value(form, "pin");
    try {
      const result = await save<{ id: string }>(
        employee ? `/api/management/employees/${employee.id}` : "/api/management/employees",
        employee ? "PATCH" : "POST",
        payload,
      );
      if (!result.ok || !result.data)
        return setError(result.error?.message ?? "Employee could not be saved.");
      router.push(`/manager/employees/${result.data.id}`);
      router.refresh();
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="management-form" onSubmit={submit}>
      <Card className="form-section">
        <h2>Employee profile</h2>
        <div className="form-grid">
          <Input
            id="employee-name"
            name="displayName"
            label="Employee name"
            defaultValue={employee?.displayName}
            required
          />
          <Input
            id="employee-number"
            name="employeeNumber"
            label="Employee number"
            defaultValue={employee?.employeeNumber}
            required
          />
          <Input
            id="employee-role"
            name="jobRole"
            label="Job role"
            defaultValue={employee?.jobRole}
            required
          />
          <Select
            id="employee-location"
            name="primaryLocationId"
            label="Primary location"
            defaultValue={employee?.primaryLocationId}
            required
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
          <Select
            id="employee-language"
            name="language"
            label="Preferred language"
            defaultValue={employee?.language ?? "en"}
          >
            <option value="en">English</option>
            <option value="es">Spanish</option>
          </Select>
          <Select
            id="employee-status"
            name="status"
            label="Status"
            defaultValue={employee?.status ?? "active"}
          >
            {statusOptions}
          </Select>
          {!employee && (
            <Input
              id="employee-pin"
              name="pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              label="Initial four-digit PIN"
              required
            />
          )}
        </div>
      </Card>
      <FormStatus error={error} />
      <Button type="submit" disabled={pending || locations.length === 0}>
        {pending ? "Saving…" : employee ? "Save employee" : "Create employee"}
      </Button>
    </form>
  );
}

export function PinResetForm({ employeeId }: { employeeId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setPending(true);
    setError(undefined);
    setMessage(undefined);
    const form = new FormData(formElement);
    const pin = value(form, "pin");
    if (pin !== value(form, "pinConfirmation")) {
      setPending(false);
      return setError("PIN entries do not match.");
    }
    try {
      const result = await save<{ message: string }>("/api/auth/employee/pin-reset", "POST", {
        employeeId,
        pin,
      });
      if (!result.ok) return setError(result.error?.message ?? "PIN could not be reset.");
      formElement.reset();
      setMessage("PIN reset. Existing employee sessions were signed out.");
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="management-form" onSubmit={submit}>
      <Card className="form-section">
        <h2>Reset employee PIN</h2>
        <p>The PIN is hashed before storage and never displayed again.</p>
        <div className="form-grid">
          <Input
            id="new-pin"
            name="pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            label="New four-digit PIN"
            required
          />
          <Input
            id="confirm-pin"
            name="pinConfirmation"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            label="Confirm PIN"
            required
          />
        </div>
      </Card>
      <FormStatus error={error} message={message} />
      <Button type="submit" disabled={pending}>
        {pending ? "Resetting…" : "Reset PIN"}
      </Button>
    </form>
  );
}

export function ManagerAssignmentsForm({
  membershipId,
  assignedLocationIds,
  locations,
}: {
  membershipId: string;
  assignedLocationIds: readonly string[];
  locations: readonly LocationOption[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    setMessage(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const result = await save(`/api/management/managers/${membershipId}/locations`, "PATCH", {
        locationIds: form.getAll("locationIds").map(String),
      });
      if (!result.ok) return setError(result.error?.message ?? "Assignments could not be saved.");
      setMessage("Location assignments saved.");
      router.refresh();
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="management-form" onSubmit={submit}>
      <Card className="form-section">
        <h2>Permitted locations</h2>
        <p>This manager can manage employees and stations only at selected locations.</p>
        <div className="checkbox-list">
          {locations.map((location) => (
            <Checkbox
              key={location.id}
              id={`location-${location.id}`}
              name="locationIds"
              value={location.id}
              label={location.name}
              defaultChecked={assignedLocationIds.includes(location.id)}
            />
          ))}
        </div>
      </Card>
      <FormStatus error={error} message={message} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save assignments"}
      </Button>
    </form>
  );
}
