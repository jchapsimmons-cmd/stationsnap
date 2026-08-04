"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash } from "@phosphor-icons/react";
import { CHECKLIST_RECURRENCE_LABELS, CHECKLIST_TYPE_LABELS } from "@/components/checklists/status";
import { Button, Card, Checkbox, Input, Select, Textarea } from "@/components/ui";

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

const CHECKLIST_TYPES = ["opening", "closing", "cleaning", "prep", "custom"] as const;
const RECURRENCE_TYPES = ["once", "daily", "weekly"] as const;

export interface ChecklistLocationOption {
  id: string;
  name: string;
}

export interface ChecklistStationOption {
  id: string;
  locationId: string;
  name: string;
}

export interface ChecklistItemDraft {
  id?: string;
  title: string;
  instructions: string;
  isRequired: boolean;
  timerSeconds: string;
  requirePhoto: boolean;
  requireApproval: boolean;
  requireNote: boolean;
}

export interface ChecklistDetailForForm {
  id: string;
  title: string;
  description: string;
  type: (typeof CHECKLIST_TYPES)[number];
  recurrenceType: (typeof RECURRENCE_TYPES)[number];
  status: "active" | "disabled";
  locationId: string;
  stationId: string | null;
  items: ReadonlyArray<{
    id: string;
    title: string;
    instructions: string;
    isRequired: boolean;
    timerSeconds: number | null;
    requirePhoto: boolean;
    requireApproval: boolean;
    requireNote: boolean;
  }>;
}

function initialItems(checklist?: ChecklistDetailForForm): ChecklistItemDraft[] {
  if (!checklist) return [];
  return checklist.items.map((item) => ({
    id: item.id,
    title: item.title,
    instructions: item.instructions,
    isRequired: item.isRequired,
    timerSeconds: item.timerSeconds != null ? String(item.timerSeconds) : "",
    requirePhoto: item.requirePhoto,
    requireApproval: item.requireApproval,
    requireNote: item.requireNote,
  }));
}

function blankItem(): ChecklistItemDraft {
  return {
    title: "",
    instructions: "",
    isRequired: true,
    timerSeconds: "",
    requirePhoto: false,
    requireApproval: false,
    requireNote: false,
  };
}

export function ChecklistForm({
  checklist,
  locations,
  stations,
}: {
  checklist?: ChecklistDetailForForm;
  locations: readonly ChecklistLocationOption[];
  stations: readonly ChecklistStationOption[];
}) {
  const router = useRouter();
  const isEdit = Boolean(checklist);

  const [title, setTitle] = useState(checklist?.title ?? "");
  const [description, setDescription] = useState(checklist?.description ?? "");
  const [type, setType] = useState<(typeof CHECKLIST_TYPES)[number]>(checklist?.type ?? "custom");
  const [recurrenceType, setRecurrenceType] = useState<(typeof RECURRENCE_TYPES)[number]>(
    checklist?.recurrenceType ?? "once",
  );
  const [status, setStatus] = useState<"active" | "disabled">(checklist?.status ?? "active");
  const [locationId, setLocationId] = useState(checklist?.locationId ?? locations[0]?.id ?? "");
  const [stationId, setStationId] = useState(checklist?.stationId ?? "");
  const [items, setItems] = useState<ChecklistItemDraft[]>(() => initialItems(checklist));

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const stationsAtLocation = stations.filter((station) => station.locationId === locationId);

  function addItem() {
    setItems((prev) => [...prev, blankItem()]);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
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

  function updateItem(index: number, patch: Partial<ChecklistItemDraft>) {
    setItems((prev) =>
      prev.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    if (items.length === 0) {
      setError("Add at least one item to the checklist.");
      return;
    }
    setPending(true);

    const body: Record<string, unknown> = {
      title,
      description,
      type,
      recurrenceType,
      status,
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        instructions: item.instructions,
        isRequired: item.isRequired,
        timerSeconds: item.timerSeconds,
        requirePhoto: item.requirePhoto,
        requireApproval: item.requireApproval,
        requireNote: item.requireNote,
      })),
    };
    if (!isEdit) {
      body["locationId"] = locationId;
      body["stationId"] = stationId;
    }

    try {
      const response = await fetch(
        isEdit && checklist
          ? `/api/management/checklists/${checklist.id}`
          : "/api/management/checklists",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const result = (await response.json()) as ApiResult<{ id: string }>;
      if (!result.ok || !result.data) {
        setError(result.error?.message ?? "This checklist could not be saved.");
        return;
      }
      router.push(`/manager/checklists/${result.data.id}`);
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
        <h2>Checklist details</h2>
        <div className="form-grid">
          <Input
            id="checklist-title"
            label="Title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={160}
            required
          />
          <Select
            id="checklist-type"
            label="Type"
            value={type}
            onChange={(event) => setType(event.target.value as (typeof CHECKLIST_TYPES)[number])}
          >
            {CHECKLIST_TYPES.map((value) => (
              <option key={value} value={value}>
                {CHECKLIST_TYPE_LABELS[value]}
              </option>
            ))}
          </Select>
          {isEdit && checklist ? (
            <div className="field">
              <span className="field__label">Location</span>
              <p>{locations.find((location) => location.id === checklist.locationId)?.name}</p>
            </div>
          ) : (
            <Select
              id="checklist-location"
              label="Location"
              value={locationId}
              onChange={(event) => {
                setLocationId(event.target.value);
                setStationId("");
              }}
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
          )}
          {isEdit && checklist ? (
            <div className="field">
              <span className="field__label">Station</span>
              <p>
                {stations.find((station) => station.id === checklist.stationId)?.name ??
                  "Any station"}
              </p>
            </div>
          ) : (
            <Select
              id="checklist-station"
              label="Station"
              hint="Optional. Leave unset if this checklist applies location-wide."
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
          <Select
            id="checklist-recurrence"
            label="Recurrence"
            value={recurrenceType}
            onChange={(event) =>
              setRecurrenceType(event.target.value as (typeof RECURRENCE_TYPES)[number])
            }
          >
            {RECURRENCE_TYPES.map((value) => (
              <option key={value} value={value}>
                {CHECKLIST_RECURRENCE_LABELS[value]}
              </option>
            ))}
          </Select>
          {isEdit && (
            <Select
              id="checklist-status"
              label="Status"
              value={status}
              onChange={(event) => setStatus(event.target.value as "active" | "disabled")}
            >
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </Select>
          )}
        </div>
        <Textarea
          id="checklist-description"
          label="Description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={2000}
        />
      </Card>

      <Card className="form-section">
        <h2>Items</h2>
        {items.length === 0 ? (
          <p className="muted">No items added yet.</p>
        ) : (
          <ol className="step-list">
            {items.map((item, index) => (
              <li key={item.id ?? `draft-${index}`}>
                <Card className="step-card">
                  <div className="step-card__head">
                    <span className="step-order-badge" aria-hidden="true">
                      {index + 1}
                    </span>
                    <div className="step-card__title">
                      <Input
                        id={`checklist-item-title-${index}`}
                        label="Item title"
                        value={item.title}
                        onChange={(event) => updateItem(index, { title: event.target.value })}
                        maxLength={160}
                        required
                      />
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
                  <Textarea
                    id={`checklist-item-instructions-${index}`}
                    label="Instructions"
                    value={item.instructions}
                    onChange={(event) => updateItem(index, { instructions: event.target.value })}
                    maxLength={2000}
                  />
                  <div className="form-grid">
                    <Input
                      id={`checklist-item-timer-${index}`}
                      type="number"
                      min={1}
                      max={7200}
                      label="Timer (seconds)"
                      hint="Optional."
                      value={item.timerSeconds}
                      onChange={(event) => updateItem(index, { timerSeconds: event.target.value })}
                    />
                  </div>
                  <div className="action-row">
                    <Checkbox
                      id={`checklist-item-required-${index}`}
                      label="Required"
                      checked={item.isRequired}
                      onChange={(event) => updateItem(index, { isRequired: event.target.checked })}
                    />
                    <Checkbox
                      id={`checklist-item-photo-${index}`}
                      label="Require photo"
                      checked={item.requirePhoto}
                      onChange={(event) =>
                        updateItem(index, { requirePhoto: event.target.checked })
                      }
                    />
                    <Checkbox
                      id={`checklist-item-note-${index}`}
                      label="Require note"
                      checked={item.requireNote}
                      onChange={(event) => updateItem(index, { requireNote: event.target.checked })}
                    />
                    <Checkbox
                      id={`checklist-item-approval-${index}`}
                      label="Require manager approval"
                      checked={item.requireApproval}
                      onChange={(event) =>
                        updateItem(index, { requireApproval: event.target.checked })
                      }
                    />
                    <Button type="button" variant="danger" onClick={() => removeItem(index)}>
                      <Trash size={18} aria-hidden="true" />
                      Remove
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        )}
        <Button type="button" onClick={addItem}>
          <Plus size={18} aria-hidden="true" />
          Add item
        </Button>
      </Card>

      {error && (
        <p className="form-status form-status--error" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : isEdit ? "Save checklist" : "Create checklist"}
      </Button>
    </form>
  );
}
