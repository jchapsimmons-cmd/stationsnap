"use client";

import { useMemo, useState, type FormEvent } from "react";
import { ASSIGNMENT_SKIP_REASON_LABELS } from "@/components/training/status";
import { Button, Card, Checkbox, Input, Select } from "@/components/ui";

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

interface AssignmentCreated {
  id: string;
  employeeId: string;
}

interface AssignmentSkipped {
  employeeId: string;
  reason: string;
}

interface BulkAssignResponse {
  created: AssignmentCreated[];
  skipped: AssignmentSkipped[];
}

export interface SopOption {
  id: string;
  title: string;
  locationId: string;
  locationName: string;
}

export interface EmployeeOption {
  id: string;
  displayName: string;
  employeeNumber: string;
  jobRole: string;
  primaryLocationId: string;
}

type TargetType = "employees" | "jobRoles" | "location";

export function AssignmentForm({
  sops,
  employees,
}: {
  sops: readonly SopOption[];
  employees: readonly EmployeeOption[];
}) {
  const [sopId, setSopId] = useState(sops[0]?.id ?? "");
  const [targetType, setTargetType] = useState<TargetType>("employees");
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [selectedJobRoles, setSelectedJobRoles] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [requiredMode, setRequiredMode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<BulkAssignResponse | null>(null);

  const selectedSop = sops.find((sop) => sop.id === sopId) ?? null;
  const employeesById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const candidateEmployees = useMemo(
    () =>
      selectedSop ? employees.filter((e) => e.primaryLocationId === selectedSop.locationId) : [],
    [employees, selectedSop],
  );
  const candidateJobRoles = useMemo(
    () => [...new Set(candidateEmployees.map((e) => e.jobRole))].sort((a, b) => a.localeCompare(b)),
    [candidateEmployees],
  );

  function selectSop(nextSopId: string) {
    setSopId(nextSopId);
    setSelectedEmployeeIds([]);
    setSelectedJobRoles([]);
    setResult(null);
  }

  function toggleEmployee(employeeId: string, checked: boolean) {
    setSelectedEmployeeIds((prev) =>
      checked ? [...prev, employeeId] : prev.filter((id) => id !== employeeId),
    );
  }

  function toggleJobRole(role: string, checked: boolean) {
    setSelectedJobRoles((prev) => (checked ? [...prev, role] : prev.filter((r) => r !== role)));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    setResult(null);

    let target: Record<string, unknown>;
    if (targetType === "employees") {
      if (selectedEmployeeIds.length === 0) {
        setPending(false);
        setError("Choose at least one employee.");
        return;
      }
      target = { type: "employees", employeeIds: selectedEmployeeIds };
    } else if (targetType === "jobRoles") {
      if (selectedJobRoles.length === 0) {
        setPending(false);
        setError("Choose at least one job role.");
        return;
      }
      target = { type: "jobRoles", jobRoles: selectedJobRoles };
    } else {
      target = { type: "location" };
    }

    try {
      const response = await fetch("/api/management/training/assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sopId,
          target,
          ...(dueDate ? { dueDate } : {}),
          ...(requiredMode ? { requiredMode } : {}),
        }),
      });
      const body = (await response.json()) as ApiResult<BulkAssignResponse>;
      if (!body.ok || !body.data) {
        setError(body.error?.message ?? "The assignment request could not be completed.");
        return;
      }
      setResult(body.data);
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="management-form" onSubmit={submit}>
      <Card className="form-section">
        <h2>Procedure</h2>
        <Select
          id="assignment-sop"
          label="Published SOP"
          value={sopId}
          onChange={(event) => selectSop(event.target.value)}
        >
          {sops.map((sop) => (
            <option key={sop.id} value={sop.id}>
              {sop.title} · {sop.locationName}
            </option>
          ))}
        </Select>
      </Card>

      <Card className="form-section">
        <h2>Who gets this training</h2>
        <div className="checkbox-list">
          <label className="check-control" htmlFor="target-employees">
            <input
              id="target-employees"
              type="radio"
              name="targetType"
              value="employees"
              checked={targetType === "employees"}
              onChange={() => setTargetType("employees")}
            />
            <span>Individual employees</span>
          </label>
          <label className="check-control" htmlFor="target-job-roles">
            <input
              id="target-job-roles"
              type="radio"
              name="targetType"
              value="jobRoles"
              checked={targetType === "jobRoles"}
              onChange={() => setTargetType("jobRoles")}
            />
            <span>Job role</span>
          </label>
          <label className="check-control" htmlFor="target-location">
            <input
              id="target-location"
              type="radio"
              name="targetType"
              value="location"
              checked={targetType === "location"}
              onChange={() => setTargetType("location")}
            />
            <span>Whole location</span>
          </label>
        </div>

        {targetType === "employees" &&
          (candidateEmployees.length === 0 ? (
            <p>No active employees at this SOP&apos;s location.</p>
          ) : (
            <div className="checkbox-list">
              {candidateEmployees.map((employee) => (
                <Checkbox
                  key={employee.id}
                  id={`employee-${employee.id}`}
                  label={`${employee.displayName} · #${employee.employeeNumber} · ${employee.jobRole}`}
                  checked={selectedEmployeeIds.includes(employee.id)}
                  onChange={(event) => toggleEmployee(employee.id, event.target.checked)}
                />
              ))}
            </div>
          ))}

        {targetType === "jobRoles" &&
          (candidateJobRoles.length === 0 ? (
            <p>No active employees at this SOP&apos;s location.</p>
          ) : (
            <div className="checkbox-list">
              {candidateJobRoles.map((role) => (
                <Checkbox
                  key={role}
                  id={`job-role-${role}`}
                  label={role}
                  checked={selectedJobRoles.includes(role)}
                  onChange={(event) => toggleJobRole(role, event.target.checked)}
                />
              ))}
            </div>
          ))}

        {targetType === "location" && selectedSop && (
          <p>
            Assigns every active employee at {selectedSop.locationName} ({candidateEmployees.length}{" "}
            {candidateEmployees.length === 1 ? "employee" : "employees"}).
          </p>
        )}
      </Card>

      <Card className="form-section">
        <h2>Schedule and mode</h2>
        <div className="form-grid">
          <Input
            id="assignment-due-date"
            name="dueDate"
            type="date"
            label="Due date"
            hint="Optional. Resolves to end of day in the SOP's location timezone."
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
          <Select
            id="assignment-required-mode"
            label="Required mode override"
            hint="Optional. Leave unset to use the SOP's default mode."
            value={requiredMode}
            onChange={(event) => setRequiredMode(event.target.value)}
          >
            <option value="">Use SOP default</option>
            <option value="learn">Learn</option>
            <option value="guided">Guided</option>
            <option value="test">Test</option>
            <option value="demonstration">Demonstration</option>
          </Select>
        </div>
      </Card>

      {error && (
        <p className="form-status form-status--error" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" disabled={pending || sops.length === 0}>
        {pending ? "Assigning…" : "Assign training"}
      </Button>

      {result && (
        <Card className="form-section">
          <h2>Result</h2>
          <p role="status">
            {result.created.length} {result.created.length === 1 ? "assignment" : "assignments"}{" "}
            created.
            {result.skipped.length > 0
              ? ` ${result.skipped.length} ${result.skipped.length === 1 ? "employee was" : "employees were"} skipped.`
              : ""}
          </p>
          {result.created.length > 0 && (
            <ul>
              {result.created.map((row) => (
                <li key={row.id}>
                  {employeesById.get(row.employeeId)?.displayName ?? row.employeeId} — assigned
                </li>
              ))}
            </ul>
          )}
          {result.skipped.length > 0 && (
            <ul>
              {result.skipped.map((row) => (
                <li key={row.employeeId}>
                  {employeesById.get(row.employeeId)?.displayName ?? row.employeeId} —{" "}
                  {ASSIGNMENT_SKIP_REASON_LABELS[row.reason] ?? row.reason}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </form>
  );
}
