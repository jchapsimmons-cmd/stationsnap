import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { writeAuditEvent } from "@/server/audit";
import { requireManagerManagedLocation } from "@/server/auth/authorization";
import { createOpaqueToken, hashToken } from "@/server/auth/crypto";
import {
  assertLoginAllowed,
  createRateLimitKey,
  recordLoginFailure,
} from "@/server/auth/rate-limit";
import type { ManagerSessionContext } from "@/server/auth/sessions";
import { getDb } from "@/server/db/client";
import {
  locations,
  organizations,
  qrCodes,
  qrScanEvents,
  sops,
  sopVersions,
  stations,
} from "@/server/db/schema";
import { getManagedLocationIds, requireActiveManagedLocation } from "@/server/management/service";
import type { QrCreateInput, QrQuery } from "@/server/qr/schemas";

function destinationPathFor(targetType: "station" | "sop", targetId: string): string {
  return targetType === "station" ? `/employee/stations/${targetId}` : `/employee/sops/${targetId}`;
}

async function assertTargetInLocation(
  organizationId: string,
  locationId: string,
  targetType: "station" | "sop",
  targetId: string,
): Promise<void> {
  if (targetType === "station") {
    const [row] = await getDb()
      .select({ id: stations.id })
      .from(stations)
      .where(
        and(
          eq(stations.id, targetId),
          eq(stations.organizationId, organizationId),
          eq(stations.locationId, locationId),
          eq(stations.status, "active"),
        ),
      )
      .limit(1);
    if (!row) throw new AppError("BAD_REQUEST", "That station is not available at this location.");
    return;
  }
  const [row] = await getDb()
    .select({ id: sops.id })
    .from(sops)
    .where(
      and(
        eq(sops.id, targetId),
        eq(sops.organizationId, organizationId),
        eq(sops.locationId, locationId),
        eq(sops.status, "published"),
      ),
    )
    .limit(1);
  if (!row) throw new AppError("BAD_REQUEST", "That SOP is not published at this location.");
}

async function auditQr(
  actor: ManagerSessionContext,
  action: "qr.created" | "qr.revoked" | "qr.rotated",
  qrCodeId: string,
  locationId: string,
  requestId?: string,
): Promise<void> {
  await writeAuditEvent({
    organizationId: actor.organizationId,
    locationId,
    actorKind: "manager",
    actorId: actor.managerUserId,
    action,
    targetType: "qr_code",
    targetId: qrCodeId,
    requestId,
  });
}

async function requireManagedQrCode(actor: ManagerSessionContext, qrCodeId: string) {
  const [row] = await getDb()
    .select()
    .from(qrCodes)
    .where(and(eq(qrCodes.id, qrCodeId), eq(qrCodes.organizationId, actor.organizationId)))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "QR code not found.");
  await requireManagerManagedLocation(actor, row.locationId);
  return row;
}

async function describeTarget(
  organizationId: string,
  targetType: "station" | "sop",
  targetId: string,
): Promise<string | null> {
  if (targetType === "station") {
    const [row] = await getDb()
      .select({ name: stations.name })
      .from(stations)
      .where(and(eq(stations.id, targetId), eq(stations.organizationId, organizationId)))
      .limit(1);
    return row?.name ?? null;
  }
  const [row] = await getDb()
    .select({ title: sopVersions.title })
    .from(sops)
    .innerJoin(
      sopVersions,
      and(
        eq(sopVersions.id, sops.currentVersionId),
        eq(sopVersions.organizationId, sops.organizationId),
      ),
    )
    .where(and(eq(sops.id, targetId), eq(sops.organizationId, organizationId)))
    .limit(1);
  return row?.title ?? null;
}

export async function createQrCode(
  actor: ManagerSessionContext,
  input: QrCreateInput,
  requestId?: string,
) {
  await requireActiveManagedLocation(actor, input.locationId, requestId);
  await assertTargetInLocation(
    actor.organizationId,
    input.locationId,
    input.targetType,
    input.targetId,
  );

  const token = createOpaqueToken();
  const id = randomUUID();
  await getDb()
    .insert(qrCodes)
    .values({
      id,
      organizationId: actor.organizationId,
      locationId: input.locationId,
      targetType: input.targetType,
      targetId: input.targetId,
      label: input.label,
      tokenHash: hashToken(token),
      createdByManagerUserId: actor.managerUserId,
    });
  await auditQr(actor, "qr.created", id, input.locationId, requestId);
  const detail = await getQrCode(actor, id);
  return { ...detail, token, scanPath: `/q/${token}` };
}

export async function listQrCodes(actor: ManagerSessionContext, query: QrQuery) {
  const managedIds = await getManagedLocationIds(actor);
  if (managedIds.length === 0) return [];
  if (query.locationId && !managedIds.includes(query.locationId)) return [];

  const conditions = [
    eq(qrCodes.organizationId, actor.organizationId),
    inArray(qrCodes.locationId, query.locationId ? [query.locationId] : managedIds),
  ];
  if (query.status) conditions.push(eq(qrCodes.status, query.status));

  const rows = await getDb()
    .select({
      id: qrCodes.id,
      locationId: qrCodes.locationId,
      locationName: locations.name,
      targetType: qrCodes.targetType,
      targetId: qrCodes.targetId,
      label: qrCodes.label,
      status: qrCodes.status,
      createdAt: qrCodes.createdAt,
      revokedAt: qrCodes.revokedAt,
    })
    .from(qrCodes)
    .innerJoin(
      locations,
      and(
        eq(locations.id, qrCodes.locationId),
        eq(locations.organizationId, qrCodes.organizationId),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(qrCodes.createdAt));

  const targetNames = new Map<string, string | null>();
  for (const row of rows) {
    const key = `${row.targetType}:${row.targetId}`;
    if (!targetNames.has(key)) {
      targetNames.set(
        key,
        await describeTarget(actor.organizationId, row.targetType, row.targetId),
      );
    }
  }
  return rows.map((row) => ({
    ...row,
    targetName: targetNames.get(`${row.targetType}:${row.targetId}`) ?? null,
  }));
}

export async function getQrCode(actor: ManagerSessionContext, qrCodeId: string) {
  const row = await requireManagedQrCode(actor, qrCodeId);
  const [location, targetName, scanEvents] = await Promise.all([
    getDb()
      .select({ name: locations.name })
      .from(locations)
      .where(eq(locations.id, row.locationId))
      .limit(1)
      .then((rows) => rows[0]?.name ?? null),
    describeTarget(actor.organizationId, row.targetType, row.targetId),
    getDb()
      .select({
        id: qrScanEvents.id,
        result: qrScanEvents.result,
        employeeId: qrScanEvents.employeeId,
        createdAt: qrScanEvents.createdAt,
      })
      .from(qrScanEvents)
      .where(eq(qrScanEvents.qrCodeId, qrCodeId))
      .orderBy(desc(qrScanEvents.createdAt))
      .limit(25),
  ]);
  return {
    id: row.id,
    locationId: row.locationId,
    locationName: location,
    targetType: row.targetType,
    targetId: row.targetId,
    targetName,
    label: row.label,
    status: row.status,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
    destinationPath: destinationPathFor(row.targetType, row.targetId),
    scanEvents,
  };
}

export async function revokeQrCode(
  actor: ManagerSessionContext,
  qrCodeId: string,
  requestId?: string,
) {
  const row = await requireManagedQrCode(actor, qrCodeId);
  if (row.status === "revoked") throw new AppError("CONFLICT", "This QR code is already revoked.");
  await getDb()
    .update(qrCodes)
    .set({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(qrCodes.id, qrCodeId));
  await auditQr(actor, "qr.revoked", qrCodeId, row.locationId, requestId);
  return getQrCode(actor, qrCodeId);
}

export async function rotateQrCode(
  actor: ManagerSessionContext,
  qrCodeId: string,
  requestId?: string,
) {
  const row = await requireManagedQrCode(actor, qrCodeId);
  if (row.status === "revoked") {
    throw new AppError("CONFLICT", "This QR code is revoked. Create a new QR code instead.");
  }
  const token = createOpaqueToken();
  await getDb()
    .update(qrCodes)
    .set({ tokenHash: hashToken(token), updatedAt: new Date() })
    .where(eq(qrCodes.id, qrCodeId));
  await auditQr(actor, "qr.rotated", qrCodeId, row.locationId, requestId);
  const detail = await getQrCode(actor, qrCodeId);
  return { ...detail, token, scanPath: `/q/${token}` };
}

export type QrResolution =
  | { status: "invalid" }
  | { status: "revoked" }
  | { status: "unavailable" }
  | {
      status: "resolved";
      organizationId: string;
      organizationSlug: string;
      locationId: string;
      locationSlug: string;
      destinationPath: string;
    };

export async function resolveQrCode(
  token: string,
  context: { ipHash: string; employeeId?: string },
): Promise<QrResolution> {
  const rateKey = createRateLimitKey("qr", context.ipHash);
  try {
    await assertLoginAllowed(rateKey);
  } catch {
    return { status: "invalid" };
  }

  const tokenHash = hashToken(token);
  const [row] = await getDb()
    .select()
    .from(qrCodes)
    .where(eq(qrCodes.tokenHash, tokenHash))
    .limit(1);

  if (!row) {
    await recordLoginFailure(rateKey);
    await getDb().insert(qrScanEvents).values({
      id: randomUUID(),
      organizationId: null,
      qrCodeId: null,
      tokenHash,
      result: "invalid",
      employeeId: context.employeeId,
      ipHash: context.ipHash,
    });
    return { status: "invalid" };
  }

  const qrRow = row;
  async function recordScan(result: "resolved" | "revoked" | "unavailable"): Promise<void> {
    await getDb().insert(qrScanEvents).values({
      id: randomUUID(),
      organizationId: qrRow.organizationId,
      qrCodeId: qrRow.id,
      tokenHash,
      result,
      employeeId: context.employeeId,
      ipHash: context.ipHash,
    });
  }

  if (row.status === "revoked") {
    await recordScan("revoked");
    return { status: "revoked" };
  }

  const [orgRow, locationRow] = await Promise.all([
    getDb()
      .select({ slug: organizations.accessSlug, status: organizations.status })
      .from(organizations)
      .where(eq(organizations.id, row.organizationId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    getDb()
      .select({ slug: locations.accessSlug, status: locations.status })
      .from(locations)
      .where(eq(locations.id, row.locationId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);
  if (!orgRow || orgRow.status !== "active" || !locationRow || locationRow.status !== "active") {
    await recordScan("unavailable");
    return { status: "unavailable" };
  }

  const targetAvailable = await isTargetAvailable(
    row.organizationId,
    row.locationId,
    row.targetType,
    row.targetId,
  );
  if (!targetAvailable) {
    await recordScan("unavailable");
    return { status: "unavailable" };
  }

  await recordScan("resolved");
  return {
    status: "resolved",
    organizationId: row.organizationId,
    organizationSlug: orgRow.slug,
    locationId: row.locationId,
    locationSlug: locationRow.slug,
    destinationPath: destinationPathFor(row.targetType, row.targetId),
  };
}

async function isTargetAvailable(
  organizationId: string,
  locationId: string,
  targetType: "station" | "sop",
  targetId: string,
): Promise<boolean> {
  try {
    await assertTargetInLocation(organizationId, locationId, targetType, targetId);
    return true;
  } catch {
    return false;
  }
}
