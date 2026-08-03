"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Checkbox, Select, Textarea } from "@/components/ui";
import { retrainingRuleTypeValues } from "@/server/sops/schemas";

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

interface LocationOption {
  id: string;
  name: string;
}

type RetrainingRuleType = (typeof retrainingRuleTypeValues)[number];

const RULE_LABELS: Record<RetrainingRuleType, string> = {
  none: "No retraining required",
  all_qualified: "Retrain everyone currently qualified on this SOP",
  selected_roles: "Retrain employees in specific job roles",
  selected_locations: "Retrain employees at specific locations",
};

export function PublishForm({
  sopId,
  revision,
  disabled,
  isUpdate,
  locations,
}: {
  sopId: string;
  revision: number;
  disabled: boolean;
  isUpdate: boolean;
  locations: readonly LocationOption[];
}) {
  const router = useRouter();
  const [changeSummary, setChangeSummary] = useState("");
  const [ruleType, setRuleType] = useState<RetrainingRuleType>("none");
  const [jobRolesText, setJobRolesText] = useState("");
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function publish() {
    setPending(true);
    setError(undefined);
    try {
      const retrainingRule =
        ruleType === "selected_roles"
          ? {
              type: "selected_roles" as const,
              jobRoles: jobRolesText
                .split(",")
                .map((role) => role.trim())
                .filter(Boolean),
            }
          : ruleType === "selected_locations"
            ? { type: "selected_locations" as const, locationIds: selectedLocationIds }
            : { type: ruleType };

      const response = await fetch(`/api/management/sops/${sopId}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: revision, changeSummary, retrainingRule }),
      });
      const result = (await response.json()) as ApiResult<{ id: string }>;
      if (!result.ok) {
        setError(result.error?.message ?? "This SOP could not be published.");
        return;
      }
      router.push(`/manager/sops/${sopId}`);
      router.refresh();
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="management-form">
      {isUpdate && (
        <>
          <Textarea
            id="publish-change-summary"
            label="What changed in this version"
            hint="Shown to managers reviewing version history."
            maxLength={2000}
            value={changeSummary}
            onChange={(event) => setChangeSummary(event.target.value)}
          />
          <Select
            id="publish-retraining-rule"
            label="Retraining rule"
            hint="Applies only when publishing an update to a previously published SOP."
            value={ruleType}
            onChange={(event) => setRuleType(event.target.value as RetrainingRuleType)}
          >
            {retrainingRuleTypeValues.map((value) => (
              <option key={value} value={value}>
                {RULE_LABELS[value]}
              </option>
            ))}
          </Select>
          {ruleType === "selected_roles" && (
            <input
              className="input"
              aria-label="Job roles, separated by commas"
              placeholder="Cook, Dishwasher"
              value={jobRolesText}
              onChange={(event) => setJobRolesText(event.target.value)}
            />
          )}
          {ruleType === "selected_locations" && (
            <fieldset className="form-section">
              <legend>Locations</legend>
              <div className="checkbox-list">
                {locations.map((location) => (
                  <Checkbox
                    key={location.id}
                    id={`publish-location-${location.id}`}
                    label={location.name}
                    checked={selectedLocationIds.includes(location.id)}
                    onChange={(event) =>
                      setSelectedLocationIds((current) =>
                        event.target.checked
                          ? [...current, location.id]
                          : current.filter((id) => id !== location.id),
                      )
                    }
                  />
                ))}
              </div>
            </fieldset>
          )}
        </>
      )}
      <Button
        type="button"
        disabled={disabled || pending || (isUpdate && changeSummary.trim().length === 0)}
        onClick={publish}
      >
        {pending ? "Publishing…" : "Publish SOP"}
      </Button>
      {error && (
        <p className="form-status form-status--error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
