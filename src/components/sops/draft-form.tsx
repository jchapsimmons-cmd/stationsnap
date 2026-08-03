"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, Input, Select, Textarea } from "@/components/ui";
import { CATEGORY_OPTIONS, DIFFICULTY_OPTIONS } from "@/components/sops/options";
import { MediaUploadField, type FileSummary } from "@/components/sops/media-upload";
import {
  MaterialsFields,
  WarningsFields,
  type MaterialRow,
  type WarningRow,
} from "@/components/sops/repeatable-fields";

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string; details?: { currentRevision?: number | null } };
}

interface LocationOption {
  id: string;
  name: string;
}

interface StationOption {
  id: string;
  name: string;
  locationId: string;
}

interface DraftInitial {
  revision: number;
  title: string;
  description: string;
  category: string;
  locationId: string;
  stationId: string;
  estimatedMinutes: number | null;
  difficulty: string;
  coverImageFile: FileSummary | null;
  sourceVideoFile: FileSummary | null;
  materials: MaterialRow[];
  warnings: WarningRow[];
}

type SaveStatus = "idle" | "saving" | "saved" | "conflict" | "error";

const AUTOSAVE_DELAY_MS = 900;

export function SopDraftForm({
  sopId,
  initial,
  locations,
  stations,
}: {
  sopId: string;
  initial: DraftInitial;
  locations: readonly LocationOption[];
  stations: readonly StationOption[];
}) {
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [category, setCategory] = useState(initial.category);
  const [locationId, setLocationId] = useState(initial.locationId);
  const [stationId, setStationId] = useState(initial.stationId);
  const [estimatedMinutes, setEstimatedMinutes] = useState(
    initial.estimatedMinutes ? String(initial.estimatedMinutes) : "",
  );
  const [difficulty, setDifficulty] = useState(initial.difficulty);
  const [coverImage, setCoverImage] = useState(initial.coverImageFile);
  const [sourceVideo, setSourceVideo] = useState(initial.sourceVideoFile);
  const [materials, setMaterials] = useState<MaterialRow[]>(initial.materials);
  const [warnings, setWarnings] = useState<WarningRow[]>(initial.warnings);

  const [revision, setRevision] = useState(initial.revision);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [message, setMessage] = useState<string>();
  const revisionRef = useRef(revision);
  useEffect(() => {
    revisionRef.current = revision;
  }, [revision]);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const stoppedRef = useRef(false);

  const availableStations = useMemo(
    () => stations.filter((station) => station.locationId === locationId),
    [stations, locationId],
  );

  const snapshot = useMemo(
    () => ({
      title,
      description,
      category,
      locationId,
      stationId,
      estimatedMinutes,
      difficulty,
      coverImageFileId: coverImage?.id ?? "",
      sourceVideoFileId: sourceVideo?.id ?? "",
      materials,
      warnings,
    }),
    [
      title,
      description,
      category,
      locationId,
      stationId,
      estimatedMinutes,
      difficulty,
      coverImage,
      sourceVideo,
      materials,
      warnings,
    ],
  );

  const save = useCallback(async () => {
    if (!dirtyRef.current || stoppedRef.current) return;
    dirtyRef.current = false;
    setStatus("saving");
    try {
      const response = await fetch(`/api/management/sops/${sopId}/draft`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...snapshot, expectedRevision: revisionRef.current }),
      });
      const result = (await response.json()) as ApiResult<{ version: { revision: number } }>;
      if (!result.ok || !result.data) {
        if (response.status === 409) {
          stoppedRef.current = true;
          setStatus("conflict");
          setMessage(
            result.error?.message ??
              "This SOP draft changed elsewhere. Reload the page to continue editing.",
          );
          return;
        }
        setStatus("error");
        setMessage(result.error?.message ?? "The draft could not be saved.");
        return;
      }
      setRevision(result.data.version.revision);
      setStatus("saved");
      setMessage(undefined);
    } catch {
      setStatus("error");
      setMessage("StationSnap could not be reached. Changes will retry on the next edit.");
    }
  }, [snapshot, sopId]);

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (stoppedRef.current) return;
    dirtyRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void save();
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [snapshot, save]);

  return (
    <div className="management-form">
      <p
        className={`autosave-status${status === "error" || status === "conflict" ? " autosave-status--error" : ""}`}
        role="status"
      >
        {status === "idle" && "Autosave ready"}
        {status === "saving" && "Saving…"}
        {status === "saved" && "Saved"}
        {status === "error" && (message ?? "Save failed")}
        {status === "conflict" && (message ?? "Reload to continue editing")}
      </p>
      <Card className="form-section">
        <h2>SOP details</h2>
        <div className="form-grid">
          <Input
            id="draft-title"
            label="Title"
            maxLength={160}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Select
            id="draft-category"
            label="Category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <Select
            id="draft-location"
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
          <Select
            id="draft-station"
            label="Station"
            hint="Optional for location-wide procedures."
            value={stationId}
            onChange={(event) => setStationId(event.target.value)}
          >
            <option value="">No specific station</option>
            {availableStations.map((station) => (
              <option key={station.id} value={station.id}>
                {station.name}
              </option>
            ))}
          </Select>
          <Input
            id="draft-estimated-minutes"
            type="number"
            min={1}
            max={600}
            label="Estimated completion time (minutes)"
            value={estimatedMinutes}
            onChange={(event) => setEstimatedMinutes(event.target.value)}
          />
          <Select
            id="draft-difficulty"
            label="Difficulty"
            value={difficulty}
            onChange={(event) => setDifficulty(event.target.value)}
          >
            {DIFFICULTY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <Textarea
          id="draft-description"
          label="Description"
          maxLength={4000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Card>

      <Card className="form-section">
        <h2>Source media</h2>
        <div className="form-grid">
          <MediaUploadField
            id="draft-cover-image"
            label="Cover image"
            kind="image"
            value={coverImage}
            onChange={setCoverImage}
          />
          <MediaUploadField
            id="draft-source-video"
            label="Source video"
            kind="video"
            hint="Optional reference recording of the procedure."
            value={sourceVideo}
            onChange={setSourceVideo}
          />
        </div>
      </Card>

      <MaterialsFields materials={materials} onChange={setMaterials} />
      <WarningsFields warnings={warnings} onChange={setWarnings} />
    </div>
  );
}
