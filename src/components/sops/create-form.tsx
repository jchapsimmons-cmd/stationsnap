"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { Button, Card, Input, Select, Textarea } from "@/components/ui";
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
  error?: { message: string };
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

export function SopCreateForm({
  locations,
  stations,
}: {
  locations: readonly LocationOption[];
  stations: readonly StationOption[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [stationId, setStationId] = useState("");
  const [coverImage, setCoverImage] = useState<FileSummary | null>(null);
  const [sourceVideo, setSourceVideo] = useState<FileSummary | null>(null);
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [warnings, setWarnings] = useState<WarningRow[]>([]);

  const availableStations = useMemo(
    () => stations.filter((station) => station.locationId === locationId),
    [stations, locationId],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    const estimatedMinutes = String(form.get("estimatedMinutes") ?? "").trim();
    try {
      const response = await fetch("/api/management/sops", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: String(form.get("title") ?? ""),
          description: String(form.get("description") ?? ""),
          category: String(form.get("category") ?? ""),
          locationId,
          stationId,
          estimatedMinutes,
          difficulty: String(form.get("difficulty") ?? ""),
          coverImageFileId: coverImage?.id ?? "",
          sourceVideoFileId: sourceVideo?.id ?? "",
          materials,
          warnings,
        }),
      });
      const result = (await response.json()) as ApiResult<{ id: string }>;
      if (!result.ok || !result.data) {
        setError(result.error?.message ?? "The SOP could not be created.");
        return;
      }
      router.push(`/manager/sops/${result.data.id}/steps`);
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="management-form" onSubmit={submit}>
      <Card className="form-section">
        <h2>SOP details</h2>
        <div className="form-grid">
          <Input id="sop-title" name="title" label="Title" maxLength={160} required />
          <Select id="sop-category" name="category" label="Category" required defaultValue="">
            <option value="" disabled>
              Choose a category
            </option>
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <Select
            id="sop-location"
            name="locationId"
            label="Location"
            value={locationId}
            onChange={(event) => {
              setLocationId(event.target.value);
              setStationId("");
            }}
            required
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
          <Select
            id="sop-station"
            name="stationId"
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
            id="sop-estimated-minutes"
            name="estimatedMinutes"
            type="number"
            min={1}
            max={600}
            label="Estimated completion time (minutes)"
          />
          <Select id="sop-difficulty" name="difficulty" label="Difficulty" defaultValue="beginner">
            {DIFFICULTY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <Textarea id="sop-description" name="description" label="Description" maxLength={4000} />
      </Card>

      <Card className="form-section">
        <h2>Source media</h2>
        <div className="form-grid">
          <MediaUploadField
            id="sop-cover-image"
            label="Cover image"
            kind="image"
            value={coverImage}
            onChange={setCoverImage}
          />
          <MediaUploadField
            id="sop-source-video"
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

      {error && (
        <p className="form-status form-status--error" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending || !locationId}>
        {pending ? "Creating…" : "Create draft and add steps"}
      </Button>
    </form>
  );
}
