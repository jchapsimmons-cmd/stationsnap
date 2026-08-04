"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Trash } from "@phosphor-icons/react";
import { VERSION_POLICY_LABELS } from "@/components/training/status";
import { Button, Card, Input, Select, Textarea, Toggle } from "@/components/ui";
import { trainingPathVersionPolicyValues } from "@/server/training/paths-schemas";

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

export interface LocationOption {
  id: string;
  name: string;
}

export interface StationOption {
  id: string;
  locationId: string;
  name: string;
}

export interface PublishedSopOption {
  id: string;
  title: string;
  locationId: string;
}

export interface TrainingPathInitial {
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
  items: readonly {
    sopId: string;
    sopTitle: string | null;
    isRequired: boolean;
    versionPolicy: (typeof trainingPathVersionPolicyValues)[number];
  }[];
}

type VersionPolicy = (typeof trainingPathVersionPolicyValues)[number];

interface ItemRow {
  sopId: string;
  isRequired: boolean;
  versionPolicy: VersionPolicy;
}

function itemsFromInitial(path?: TrainingPathInitial): ItemRow[] {
  if (!path) return [];
  return path.items.map((item) => ({
    sopId: item.sopId,
    isRequired: item.isRequired,
    versionPolicy: item.versionPolicy,
  }));
}

/**
 * Shared between the training-paths create and edit pages. Location and station are only
 * editable on create — `updatePath` has no fields for them, so in edit mode they render as
 * read-only text instead of controls.
 */
export function TrainingPathForm({
  locations,
  stations,
  sops,
  path,
}: {
  locations: readonly LocationOption[];
  stations: readonly StationOption[];
  sops: readonly PublishedSopOption[];
  path?: TrainingPathInitial;
}) {
  const router = useRouter();
  const isEdit = Boolean(path);

  const [title, setTitle] = useState(path?.title ?? "");
  const [description, setDescription] = useState(path?.description ?? "");
  const [locationId, setLocationId] = useState(path?.locationId ?? locations[0]?.id ?? "");
  const [stationId, setStationId] = useState(path?.stationId ?? "");
  const [enforceOrder, setEnforceOrder] = useState(path?.enforceOrder ?? true);
  const [status, setStatus] = useState<"active" | "disabled">(path?.status ?? "active");
  const [defName, setDefName] = useState(path?.definition.name ?? "");
  const [defDescription, setDefDescription] = useState(path?.definition.description ?? "");
  const [defValidityDays, setDefValidityDays] = useState(
    path?.definition.defaultValidityDays != null ? String(path.definition.defaultValidityDays) : "",
  );
  const [items, setItems] = useState<ItemRow[]>(itemsFromInitial(path));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const sopsById = useMemo(() => new Map(sops.map((sop) => [sop.id, sop])), [sops]);
  const candidateStations = useMemo(
    () => stations.filter((station) => station.locationId === locationId),
    [stations, locationId],
  );
  const candidateSops = useMemo(
    () => sops.filter((sop) => sop.locationId === locationId),
    [sops, locationId],
  );
  const availableSops = useMemo(
    () => candidateSops.filter((sop) => !items.some((item) => item.sopId === sop.id)),
    [candidateSops, items],
  );

  function selectLocation(nextLocationId: string) {
    setLocationId(nextLocationId);
    setStationId("");
    setItems([]);
  }

  function addItem(sopId: string) {
    if (!sopId) return;
    setItems((prev) => [...prev, { sopId, isRequired: true, versionPolicy: "current_version" }]);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
  }

  function updateItem(index: number, patch: Partial<ItemRow>) {
    setItems((prev) =>
      prev.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    );
  }

  function moveItem(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= items.length) return;
    setItems((prev) => {
      const reordered = [...prev];
      const [moved] = reordered.splice(index, 1);
      if (!moved) return prev;
      reordered.splice(targetIndex, 0, moved);
      return reordered;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);

    if (title.trim().length === 0) {
      setError("Title is required.");
      return;
    }
    if (defName.trim().length === 0) {
      setError("Qualification name is required.");
      return;
    }
    if (items.length === 0) {
      setError("Add at least one SOP to the path.");
      return;
    }

    setPending(true);
    try {
      const body: Record<string, unknown> = {
        title,
        description,
        enforceOrder,
        status,
        definition: {
          name: defName,
          description: defDescription,
          defaultValidityDays: defValidityDays,
        },
        items: items.map((item) => ({
          sopId: item.sopId,
          isRequired: item.isRequired,
          versionPolicy: item.versionPolicy,
        })),
      };
      if (!isEdit) {
        body["locationId"] = locationId;
        body["stationId"] = stationId;
      }

      const response = await fetch(
        isEdit ? `/api/management/training/paths/${path?.id}` : "/api/management/training/paths",
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
            required
          />
          <Select
            id="path-status"
            label="Status"
            value={status}
            onChange={(event) => setStatus(event.target.value as "active" | "disabled")}
          >
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </Select>
        </div>
        <Textarea
          id="path-description"
          label="Description"
          maxLength={2_000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <Toggle
          id="path-enforce-order"
          label="Require required SOPs to be completed in order"
          checked={enforceOrder}
          onChange={(event) => setEnforceOrder(event.target.checked)}
        />
      </Card>

      <Card className="form-section">
        <h2>Location</h2>
        {isEdit && path ? (
          <div className="form-grid">
            <div className="field">
              <p className="field__label">Location</p>
              <p>{path.locationName}</p>
            </div>
            <div className="field">
              <p className="field__label">Station</p>
              <p>{path.stationName ?? "Whole location"}</p>
            </div>
          </div>
        ) : (
          <div className="form-grid">
            <Select
              id="path-location"
              label="Location"
              value={locationId}
              onChange={(event) => selectLocation(event.target.value)}
              required
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
            <Select
              id="path-station"
              label="Station"
              hint="Optional. Leave unset for a location-wide path."
              value={stationId}
              onChange={(event) => setStationId(event.target.value)}
            >
              <option value="">Whole location</option>
              {candidateStations.map((station) => (
                <option key={station.id} value={station.id}>
                  {station.name}
                </option>
              ))}
            </Select>
          </div>
        )}
      </Card>

      <Card className="form-section">
        <h2>Qualification</h2>
        <p className="muted">
          Awarded automatically when an employee completes every required SOP below.
        </p>
        <div className="form-grid">
          <Input
            id="path-definition-name"
            label="Qualification name"
            value={defName}
            onChange={(event) => setDefName(event.target.value)}
            required
          />
          <Input
            id="path-definition-validity"
            type="number"
            min={1}
            max={3_650}
            label="Default validity (days)"
            hint="Optional. Leave blank for a qualification that never expires."
            value={defValidityDays}
            onChange={(event) => setDefValidityDays(event.target.value)}
          />
        </div>
        <Textarea
          id="path-definition-description"
          label="Qualification description"
          maxLength={2_000}
          value={defDescription}
          onChange={(event) => setDefDescription(event.target.value)}
        />
      </Card>

      <Card className="form-section">
        <h2>Required SOPs</h2>
        {items.length === 0 ? (
          <p>No SOPs added yet.</p>
        ) : (
          <ol className="step-list">
            {items.map((item, index) => {
              const sop = sopsById.get(item.sopId);
              return (
                <li key={`${item.sopId}-${index}`}>
                  <Card className="step-card">
                    <div className="step-card__head">
                      <span className="step-order-badge" aria-hidden="true">
                        {index + 1}
                      </span>
                      <div className="step-card__title">
                        <strong>{sop?.title ?? "Unknown SOP"}</strong>
                      </div>
                      <div className="reorder-buttons">
                        <Button
                          type="button"
                          variant="secondary"
                          aria-label={`Move item ${index + 1} up`}
                          disabled={index === 0}
                          onClick={() => moveItem(index, -1)}
                        >
                          <ArrowUp size={18} aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          aria-label={`Move item ${index + 1} down`}
                          disabled={index === items.length - 1}
                          onClick={() => moveItem(index, 1)}
                        >
                          <ArrowDown size={18} aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                    <div className="form-grid">
                      <Select
                        id={`path-item-${index}-version-policy`}
                        label="Version policy"
                        value={item.versionPolicy}
                        onChange={(event) =>
                          updateItem(index, { versionPolicy: event.target.value as VersionPolicy })
                        }
                      >
                        {trainingPathVersionPolicyValues.map((value) => (
                          <option key={value} value={value}>
                            {VERSION_POLICY_LABELS[value]}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Toggle
                      id={`path-item-${index}-required`}
                      label="Required to earn the qualification"
                      checked={item.isRequired}
                      onChange={(event) => updateItem(index, { isRequired: event.target.checked })}
                    />
                    <div className="action-row">
                      <Button type="button" variant="danger" onClick={() => removeItem(index)}>
                        <Trash size={18} aria-hidden="true" />
                        Remove
                      </Button>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
        <Select
          id="path-add-item"
          label="Add a published SOP"
          value=""
          onChange={(event) => addItem(event.target.value)}
          disabled={availableSops.length === 0}
        >
          <option value="">
            {availableSops.length === 0
              ? "No more published SOPs at this location"
              : "Choose an SOP…"}
          </option>
          {availableSops.map((sop) => (
            <option key={sop.id} value={sop.id}>
              {sop.title}
            </option>
          ))}
        </Select>
      </Card>

      {error && (
        <p className="form-status form-status--error" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" disabled={pending || locations.length === 0}>
        {pending ? "Saving…" : isEdit ? "Save path" : "Create path"}
      </Button>
    </form>
  );
}
