"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { Button, Card, ConfirmationDialog, Input, Select } from "@/components/ui";

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

interface LocationOption {
  id: string;
  name: string;
}

interface TargetOption {
  id: string;
  label: string;
  locationId: string;
  type: "station" | "sop";
}

interface CreatedQr {
  id: string;
  label: string;
  scanPath: string;
  token: string;
}

export function QrCreateForm({
  locations,
  targets,
}: {
  locations: readonly LocationOption[];
  targets: readonly TargetOption[];
}) {
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [targetType, setTargetType] = useState<"station" | "sop">("station");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<CreatedQr | null>(null);

  const filteredTargets = useMemo(
    () =>
      targets.filter((target) => target.locationId === locationId && target.type === targetType),
    [targets, locationId, targetType],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/management/qr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          locationId,
          targetType,
          targetId: String(form.get("targetId") ?? ""),
          label: String(form.get("label") ?? ""),
        }),
      });
      const result = (await response.json()) as ApiResult<CreatedQr>;
      if (!result.ok || !result.data) {
        setError(result.error?.message ?? "The QR code could not be created.");
        return;
      }
      setCreated(result.data);
    } catch {
      setError("StationSnap could not be reached. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (created) {
    return <QrPrintCard scanPath={created.scanPath} label={created.label} qrCodeId={created.id} />;
  }

  return (
    <form className="management-form" onSubmit={submit}>
      <Card className="form-section">
        <h2>QR details</h2>
        <div className="form-grid">
          <Select
            id="qr-location"
            label="Location"
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
            required
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
          <Select
            id="qr-target-type"
            label="Points to"
            value={targetType}
            onChange={(event) => setTargetType(event.target.value as "station" | "sop")}
          >
            <option value="station">Station</option>
            <option value="sop">Published SOP</option>
          </Select>
          <Select
            id="qr-target"
            name="targetId"
            label={targetType === "station" ? "Station" : "SOP"}
            required
            hint={
              filteredTargets.length === 0
                ? "Nothing available for this location and type yet."
                : undefined
            }
          >
            <option value="">Choose one</option>
            {filteredTargets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.label}
              </option>
            ))}
          </Select>
          <Input
            id="qr-label"
            name="label"
            label="Label (optional)"
            placeholder="e.g. Grill station poster"
            maxLength={120}
          />
        </div>
        {error && (
          <p className="form-status form-status--error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending || filteredTargets.length === 0}>
          {pending ? "Creating…" : "Create QR code"}
        </Button>
      </Card>
    </form>
  );
}

function QrPrintCard({
  scanPath,
  label,
  qrCodeId,
}: {
  scanPath: string;
  label: string;
  qrCodeId: string;
}) {
  const router = useRouter();
  const [qrImage, setQrImage] = useState<string>();
  const scanUrl = typeof window !== "undefined" ? `${window.location.origin}${scanPath}` : scanPath;

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(scanUrl, { margin: 1, width: 320 })
      .then((dataUrl) => {
        if (!cancelled) setQrImage(dataUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [scanUrl]);

  return (
    <Card className="qr-print-card">
      <h2>{label || "QR code created"}</h2>
      <p>
        Print or save this now — the scannable link is shown only once. If it’s lost or damaged,
        reissue a new one from this QR’s detail page.
      </p>
      {qrImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="qr-print-card__image" src={qrImage} alt={`QR code linking to ${scanUrl}`} />
      )}
      <p className="qr-print-card__url">
        <strong>Scan link:</strong> <code>{scanUrl}</code>
      </p>
      <div className="action-row">
        <Button type="button" onClick={() => window.print()}>
          Print
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.push(`/manager/qr/${qrCodeId}`)}
        >
          Done
        </Button>
      </div>
    </Card>
  );
}

export function QrRevokeButton({ qrCodeId }: { qrCodeId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function confirm() {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/management/qr/${qrCodeId}/revoke`, { method: "POST" });
      const result = (await response.json()) as ApiResult<{ id: string }>;
      if (!result.ok) {
        setError(result.error?.message ?? "This QR code could not be revoked.");
        setOpen(false);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("StationSnap could not be reached. Try again.");
      setOpen(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button type="button" variant="danger" disabled={pending} onClick={() => setOpen(true)}>
        Revoke QR code
      </Button>
      {error && (
        <p className="form-status form-status--error" role="alert">
          {error}
        </p>
      )}
      <ConfirmationDialog
        open={open}
        title="Revoke QR code"
        description="Any printed poster using this code will stop working immediately. This cannot be undone."
        confirmLabel="Revoke"
        onConfirm={confirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

export function QrRotateButton({ qrCodeId, label }: { qrCodeId: string; label: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<CreatedQr | null>(null);
  const [open, setOpen] = useState(false);

  async function confirm() {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/management/qr/${qrCodeId}/rotate`, { method: "POST" });
      const result = (await response.json()) as ApiResult<CreatedQr>;
      if (!result.ok || !result.data) {
        setError(result.error?.message ?? "This QR code could not be reissued.");
        setOpen(false);
        return;
      }
      setOpen(false);
      setCreated(result.data);
    } catch {
      setError("StationSnap could not be reached. Try again.");
      setOpen(false);
    } finally {
      setPending(false);
    }
  }

  if (created) {
    return <QrPrintCard scanPath={created.scanPath} label={label} qrCodeId={qrCodeId} />;
  }

  return (
    <>
      <Button type="button" variant="secondary" disabled={pending} onClick={() => setOpen(true)}>
        Reissue and print
      </Button>
      {error && (
        <p className="form-status form-status--error" role="alert">
          {error}
        </p>
      )}
      <ConfirmationDialog
        open={open}
        title="Reissue this QR code"
        description="The current printed poster will stop working as soon as you reissue. Only do this if it's lost or damaged."
        confirmLabel="Reissue"
        tone="danger"
        onConfirm={confirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
