"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import type { PathItemVersionPolicy } from "@/components/training/path-form";

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

/**
 * Archives or reactivates a path via the same PATCH route the edit form uses. `updatePath` requires
 * the full payload (there is no dedicated status-only endpoint), so this resends the path's current
 * fields with only `status` flipped.
 */
export function PathStatusToggle({
  pathId,
  status,
  title,
  description,
  enforceOrder,
  definition,
  items,
}: {
  pathId: string;
  status: "active" | "disabled";
  title: string;
  description: string;
  enforceOrder: boolean;
  definition: { name: string; description: string; defaultValidityDays: number | null };
  items: ReadonlyArray<{
    sopId: string;
    isRequired: boolean;
    versionPolicy: PathItemVersionPolicy;
  }>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const nextStatus = status === "active" ? "disabled" : "active";

  async function toggle() {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/management/training/paths/${pathId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          enforceOrder,
          status: nextStatus,
          definition: {
            name: definition.name,
            description: definition.description,
            defaultValidityDays: definition.defaultValidityDays ?? "",
          },
          items: items.map((item) => ({
            sopId: item.sopId,
            isRequired: item.isRequired,
            versionPolicy: item.versionPolicy,
          })),
        }),
      });
      const result = (await response.json()) as ApiResult<{ id: string }>;
      if (!result.ok) {
        setError(result.error?.message ?? "This training path could not be updated.");
        return;
      }
      router.refresh();
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {error && (
        <p className="form-status form-status--error" role="alert">
          {error}
        </p>
      )}
      <Button
        type="button"
        variant={status === "active" ? "danger" : "secondary"}
        disabled={pending}
        onClick={() => void toggle()}
      >
        {pending ? "Saving…" : status === "active" ? "Disable path" : "Reactivate path"}
      </Button>
    </>
  );
}
