"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash } from "@phosphor-icons/react";
import { TRAINING_PATH_VERSION_POLICY_LABELS } from "@/components/training/status";
import { Button, Card, Checkbox, Input, Select, Textarea } from "@/components/ui";

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

export type PathItemVersionPolicy = "current_version" | "any_passed_version";

export interface PathSopOption {
  id: string;
  title: string;
  locationId: string;
  locationName: string;
}

export interface PathLocationOption {
  id: string;
  name: string;
}

export interface PathStationOption {
  id: string;
  locationId: string;
  name: string;
}

export interface PathDetailForForm {
  id: string;
  title: string;
  description: string;
  locationId: string;
  locationName: string;
  stationId: string | null;
  stationName: string | null;
  enforceOrder: boolean;
  status: "active" | "disabled";
  definition: {
    name: string;
    description: string;
    defaultValidityDays: number | null;
  };
  items: ReadonlyArray<{
    sopId: string;
    sopTitle: string | null;
    isRequired: boolean;
    versionPolicy: PathItemVersionPolicy;
  }>;
}

interface PathItemDraft {
  sopId: string;
  sopTitle: string;
  isRequired: boolean;
  versionPolicy: PathItemVersionPolicy;
}

function initialItems(path?: PathDetailForForm): PathItemDraft[] {
  if (!path) return [];
  return path.items.map((item) => ({
    sopId: item.sopId,
    sopTitle: item.sopTitle ?? "Untitled SOP",
    isRequired: item.isRequired,
    versionPolicy: item.versionPolicy,
  }));
}

/**
 * Creates or edits a training path and its 1:1 qualification definition. Location and station are
 * fixed at creation and never editable afterward, so this component only renders those pickers when
 * `path` is absent.
 */
export function PathForm({
  path,
  locations,
  stations,
  sops,
}: {
  path?: PathDetailForForm;
  locations: readonly PathLocationOption[];
  stations: readonly PathStationOption[];
  sops: readonly PathSopOption[];
}) {
  const router = useRouter();
  const isEdit = Boolean(path);

  const [title, setTitle] = useState(path?.title ?? "");
  const [description, setDescription] = useState(path?.description ?? "");
  const [locationId, setLocationId] = useState(path?.locationId ?? locations[0]?.id ?? "");
  const [stationId, setStationId] = useState(path?.stationId ?? "");
  const [enforceOrder, setEnforceOrder] = useState(path?.enforceOrder ?? true);
  const [definitionName, setDefinitionName] = useState(path?.definition.name ?? "");
  const [definitionDescription, setDefinitionDescription] = useState(
    path?.definition.description ?? "",
  );
  const [defaultValidityDays, setDefaultValidityDays] = useState(
    path?.definition.defaultValidityDays != null ? String(path.definition.defaultValidityDays) : "",
  );
  const [items, setItems] = useState<PathItemDraft[]>(() => initialItems(path));

  const [addSopId, setAddSopId] = useState("");
  const [addIsRequired, setAddIsRequired] = useState(true);
  const [addVersionPolicy, setAddVersionPolicy] =
    useState<PathItemVersionPolicy>("current_version");

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const effectiveLocationId = path?.locationId ?? locationId;

  const sopsAtLocation = useMemo(
    () => sops.filter((sop) => sop.locationId === effectiveLocationId),
    [sops, effectiveLocationId],
  );
  const stationsAtLocation = useMemo(
    () => stations.filter((station) => station.locationId === locationId),
    [stations, locationId],
  );
  const candidateSops = useMemo(
    () => sopsAtLocation.filter((sop) => !items.some((item) => item.sopId === sop.id)),
    [sopsAtLocation, items],
  );

  function selectLocation(nextLocationId: string) {
    setLocationId(nextLocationId);
    setStationId("");
    setItems([]);
    setAddSopId("");
  }

  function addItem() {
    const sop = candidateSops.find((row) => row.id === addSopId);
    if (!sop) return;
    setItems((prev) => [
      ...prev,
      {
        sopId: sop.id,
        sopTitle: sop.title,
        isRequired: addIsRequired,
        versionPolicy: addVersionPolicy,
      },
    ]);
    setAddSopId("");
    setAddIsRequired(true);
    setAddVersionPolicy("current_version");
  }

  function removeItem(sopId: string) {
    setItems((prev) => prev.filter((item) => item.sopId !== sopId));
  }

  function moveItem(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= items.length) return;
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      if (!moved) return prev;
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    if (items.length === 0) {
      setError("Add at least one SOP to the path.");
      return;
    }
    setPending(true);

    const body: Record<string, unknown> = {
      title,
      description,
      enforceOrder,
      definition: {
        name: definitionName,
        description: definitionDescription,
        defaultValidityDays,
      },
      items: items.map((item) => ({
        sopId: item.sopId,
        isRequired: item.isRequired,
        versionPolicy: item.versionPolicy,
      })),
    };
    if (isEdit && path) {
      body["status"] = path.status;
    } else {
      body["locationId"] = locationId;
      body["stationId"] = stationId;
    }

    try {
      const response = await fetch(
        isEdit && path
          ? `/api/management/training/paths/${path.id}`
          : "/api/management/training/paths",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const result = (await response.json()) as ApiResult<{ id: string }>;
      if (!result.ok || !result.data) {
        setError(result.error?.message ?? "This training path could not be saved.");
        return;
      }
      router.push(`/manager/training/paths/${result.data.id}`);
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
        <h2>Path details</h2>
        <div className="form-grid">
          <Input
            id="path-title"
            label="Title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={160}
            required
          />
          {isEdit && path ? (
            <div className="field">
              <span className="field__label">Location</span>
              <p>{path.locationName}</p>
            </div>
          ) : (
            <Select
              id="path-location"
              label="Location"
              value={locationId}
              onChange={(event) => selectLocation(event.target.value)}
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
          )}
          {isEdit && path ? (
            <div className="field">
              <span className="field__label">Station</span>
              <p>{path.stationName ?? "Any station"}</p>
            </div>
          ) : (
            <Select
              id="path-station"
              label="Station"
              hint="Optional. Leave unset if this qualification applies location-wide."
              value={stationId}
              onChange={(event) => setStationId(event.target.value)}
            >
              <option value="">No specific station</option>
              {stationsAtLocation.map((station) => (
                <option key={station.id} value={station.id}>
                  {station.name}
                </option>
              ))}
            </Select>
          )}
        </div>
        <Textarea
          id="path-description"
          label="Description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={2000}
        />
        <Checkbox
          id="path-enforce-order"
          label="Require completion in order"
          checked={enforceOrder}
          onChange={(event) => setEnforceOrder(event.target.checked)}
        />
        <p className="field__message">
          Employees must complete required procedures in this order to earn the qualification.
        </p>
      </Card>

      <Card className="form-section">
        <h2>Qualification awarded</h2>
        <div className="form-grid">
          <Input
            id="path-definition-name"
            label="Qualification name"
            value={definitionName}
            onChange={(event) => setDefinitionName(event.target.value)}
            maxLength={160}
            required
          />
          <Input
            id="path-definition-validity"
            type="number"
            min={1}
            max={3650}
            label="Default validity (days)"
            hint="Optional. Leave blank if this qualification never expires."
            value={defaultValidityDays}
            onChange={(event) => setDefaultValidityDays(event.target.value)}
          />
        </div>
        <Textarea
          id="path-definition-description"
          label="Qualification description"
          value={definitionDescription}
          onChange={(event) => setDefinitionDescription(event.target.value)}
          maxLength={2000}
        />
      </Card>

      <Card className="form-section">
        <h2>Required procedures</h2>
        {effectiveLocationId === "" ? (
          <p className="muted">Choose a location to see its published SOPs.</p>
        ) : sopsAtLocation.length === 0 ? (
          <p className="muted">No training-enabled published SOPs exist at this location yet.</p>
        ) : (
          <div className="form-grid">
            <Select
              id="path-add-sop"
              label="Published SOP"
              value={addSopId}
              onChange={(event) => setAddSopId(event.target.value)}
            >
              <option value="">Choose a SOP…</option>
              {candidateSops.map((sop) => (
                <option key={sop.id} value={sop.id}>
                  {sop.title}
                </option>
              ))}
            </Select>
            <Select
              id="path-add-version-policy"
              label="Version policy"
              value={addVersionPolicy}
              onChange={(event) => setAddVersionPolicy(event.target.value as PathItemVersionPolicy)}
            >
              <option value="current_version">
                {TRAINING_PATH_VERSION_POLICY_LABELS["current_version"]}
              </option>
              <option value="any_passed_version">
                {TRAINING_PATH_VERSION_POLICY_LABELS["any_passed_version"]}
              </option>
            </Select>
          </div>
        )}
        {sopsAtLocation.length > 0 && (
          <>
            <Checkbox
              id="path-add-required"
              label="Required item"
              checked={addIsRequired}
              onChange={(event) => setAddIsRequired(event.target.checked)}
            />
            <Button type="button" disabled={!addSopId} onClick={addItem}>
              <Plus size={18} aria-hidden="true" />
              Add to path
            </Button>
          </>
        )}

        {items.length === 0 ? (
          <p className="muted">No SOPs added yet.</p>
        ) : (
          <ol className="step-list">
            {items.map((item, index) => (
              <li key={item.sopId}>
                <Card className="step-card">
                  <div className="step-card__head">
                    <span className="step-order-badge" aria-hidden="true">
                      {index + 1}
                    </span>
                    <div className="step-card__title">
                      <strong>{item.sopTitle}</strong>
                      <small>
                        {item.isRequired ? "Required" : "Optional"} ·{" "}
                        {TRAINING_PATH_VERSION_POLICY_LABELS[item.versionPolicy]}
                      </small>
                    </div>
                    <div className="reorder-buttons">
                      <Button
                        type="button"
                        variant="secondary"
                        aria-label={`Move ${item.sopTitle} up`}
                        disabled={index === 0}
                        onClick={() => moveItem(index, -1)}
                      >
                        <ArrowUp size={18} aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        aria-label={`Move ${item.sopTitle} down`}
                        disabled={index === items.length - 1}
                        onClick={() => moveItem(index, 1)}
                      >
                        <ArrowDown size={18} aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                  <div className="action-row">
                    <Checkbox
                      id={`path-item-required-${item.sopId}`}
                      label="Required"
                      checked={item.isRequired}
                      onChange={(event) =>
                        setItems((prev) =>
                          prev.map((row) =>
                            row.sopId === item.sopId
                              ? { ...row, isRequired: event.target.checked }
                              : row,
                          ),
                        )
                      }
                    />
                    <Button type="button" variant="danger" onClick={() => removeItem(item.sopId)}>
                      <Trash size={18} aria-hidden="true" />
                      Remove
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {error && (
        <p className="form-status form-status--error" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : isEdit ? "Save path" : "Create path"}
      </Button>
    </form>
  );
}
