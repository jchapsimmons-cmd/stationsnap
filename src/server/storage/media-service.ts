import { createHash, randomUUID } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { writeAuditEvent } from "@/server/audit";
import { managerCanManageLocation } from "@/server/auth/authorization";
import type { EmployeeSessionContext, ManagerSessionContext } from "@/server/auth/sessions";
import { getDb } from "@/server/db/client";
import {
  files,
  sops,
  sopSteps,
  sopVersions,
  trainingAssignments,
  trainingEvidence,
  trainingSessions,
} from "@/server/db/schema";
import { maxBytesForMediaType, mediaTypeForMime } from "@/server/storage/constants";
import { createObjectKey, readStoredObject, writeStoredObject } from "@/server/storage/driver";
import { matchesDeclaredSignature } from "@/server/storage/file-signature";

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\r\n"]/g, "").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 200) : "upload";
}

async function storeUploadedFile(
  formData: FormData,
  organizationId: string,
  uploader: { managerUserId: string } | { employeeId: string },
): Promise<{
  id: string;
  mediaType: "image" | "video";
  originalName: string;
  mimeType: string;
  byteSize: number;
  status: "processing" | "ready" | "failed";
}> {
  const entry = formData.get("file");
  if (!(entry instanceof File)) {
    throw new AppError("BAD_REQUEST", "A file is required.");
  }
  const mediaType = mediaTypeForMime(entry.type);
  if (!mediaType) {
    throw new AppError("BAD_REQUEST", "That file type is not supported.");
  }
  const maxBytes = maxBytesForMediaType(mediaType);
  if (entry.size > maxBytes) {
    throw new AppError("BAD_REQUEST", "The file exceeds the allowed size.");
  }
  const buffer = Buffer.from(await entry.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    throw new AppError("BAD_REQUEST", "The file exceeds the allowed size.");
  }
  if (buffer.byteLength === 0) {
    throw new AppError("BAD_REQUEST", "The file is empty.");
  }
  if (!matchesDeclaredSignature(entry.type, buffer)) {
    throw new AppError("BAD_REQUEST", "The file's contents do not match its declared type.");
  }
  const checksum = createHash("sha256").update(buffer).digest("hex");
  const objectKey = createObjectKey(organizationId);
  await writeStoredObject(objectKey, buffer);

  const [row] = await getDb()
    .insert(files)
    .values({
      id: randomUUID(),
      organizationId,
      uploaderManagerUserId: "managerUserId" in uploader ? uploader.managerUserId : null,
      uploaderEmployeeId: "employeeId" in uploader ? uploader.employeeId : null,
      objectKey,
      originalName: sanitizeFileName(entry.name),
      mediaType,
      mimeType: entry.type,
      byteSize: buffer.byteLength,
      checksum,
      status: "ready",
    })
    .returning();
  if (!row) throw new AppError("INTERNAL_ERROR", "The upload could not be saved.");
  return row;
}

export async function uploadMedia(
  actor: ManagerSessionContext,
  formData: FormData,
  requestId?: string,
) {
  const row = await storeUploadedFile(formData, actor.organizationId, {
    managerUserId: actor.managerUserId,
  });

  await writeAuditEvent({
    organizationId: actor.organizationId,
    actorKind: "manager",
    actorId: actor.managerUserId,
    action: "media.uploaded",
    targetType: "file",
    targetId: row.id,
    metadata: { mediaType: row.mediaType, byteSize: row.byteSize },
    requestId,
  });

  return {
    id: row.id,
    mediaType: row.mediaType,
    originalName: row.originalName,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    status: row.status,
  };
}

export async function uploadEmployeeMedia(
  session: EmployeeSessionContext,
  formData: FormData,
  requestId?: string,
) {
  const row = await storeUploadedFile(formData, session.organizationId, {
    employeeId: session.employeeId,
  });

  await writeAuditEvent({
    organizationId: session.organizationId,
    locationId: session.locationId,
    actorKind: "employee",
    actorId: session.employeeId,
    action: "media.uploaded",
    targetType: "file",
    targetId: row.id,
    metadata: { mediaType: row.mediaType, byteSize: row.byteSize },
    requestId,
  });

  return {
    id: row.id,
    mediaType: row.mediaType,
    originalName: row.originalName,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    status: row.status,
  };
}

export async function getMediaFile(actor: ManagerSessionContext, fileId: string) {
  const [row] = await getDb()
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.organizationId, actor.organizationId)))
    .limit(1);
  if (!row || row.status !== "ready") throw new AppError("NOT_FOUND", "File not found.");

  // Employee-uploaded training evidence is location-scoped, not merely organization-scoped: a
  // manager may only read the proof attached to an assignment at a location they manage.
  // Manager-authored SOP media gets the equivalent check below.
  if (row.uploaderEmployeeId) {
    const [evidenceMatch] = await getDb()
      .select({ locationId: trainingAssignments.locationId })
      .from(trainingEvidence)
      .innerJoin(
        trainingSessions,
        and(
          eq(trainingSessions.id, trainingEvidence.sessionId),
          eq(trainingSessions.organizationId, trainingEvidence.organizationId),
        ),
      )
      .innerJoin(
        trainingAssignments,
        and(
          eq(trainingAssignments.id, trainingSessions.assignmentId),
          eq(trainingAssignments.organizationId, trainingSessions.organizationId),
        ),
      )
      .where(
        and(
          eq(trainingEvidence.organizationId, actor.organizationId),
          eq(trainingEvidence.fileId, fileId),
        ),
      )
      .limit(1);
    if (!evidenceMatch) throw new AppError("NOT_FOUND", "File not found.");
    if (!(await managerCanManageLocation(actor, evidenceMatch.locationId))) {
      throw new AppError("NOT_FOUND", "File not found.");
    }
  } else {
    // Manager-authored SOP media (cover image, source video, or a step's image/video) is scoped
    // to the owning SOP's location exactly like every other manager-facing SOP read, not merely
    // to the organization: a manager restricted to one location must not be able to read another
    // location's SOP media by fileId alone. A file not yet attached to any SOP field (a fresh
    // upload mid-draft-edit, before the draft is saved) has no location to check yet and is only
    // visible to the manager who uploaded it.
    const [versionMatch] = await getDb()
      .select({ locationId: sops.locationId })
      .from(sopVersions)
      .innerJoin(
        sops,
        and(eq(sops.id, sopVersions.sopId), eq(sops.organizationId, sopVersions.organizationId)),
      )
      .where(
        and(
          eq(sopVersions.organizationId, actor.organizationId),
          or(eq(sopVersions.coverImageFileId, fileId), eq(sopVersions.sourceVideoFileId, fileId)),
        ),
      )
      .limit(1);
    const [stepMatch] = versionMatch
      ? []
      : await getDb()
          .select({ locationId: sops.locationId })
          .from(sopSteps)
          .innerJoin(
            sopVersions,
            and(
              eq(sopVersions.id, sopSteps.sopVersionId),
              eq(sopVersions.organizationId, sopSteps.organizationId),
            ),
          )
          .innerJoin(
            sops,
            and(
              eq(sops.id, sopVersions.sopId),
              eq(sops.organizationId, sopVersions.organizationId),
            ),
          )
          .where(
            and(
              eq(sopSteps.organizationId, actor.organizationId),
              or(eq(sopSteps.imageFileId, fileId), eq(sopSteps.videoFileId, fileId)),
            ),
          )
          .limit(1);
    const locationMatch = versionMatch ?? stepMatch ?? null;
    if (locationMatch) {
      if (!(await managerCanManageLocation(actor, locationMatch.locationId))) {
        throw new AppError("NOT_FOUND", "File not found.");
      }
    } else if (row.uploaderManagerUserId !== actor.managerUserId) {
      throw new AppError("NOT_FOUND", "File not found.");
    }
  }

  const buffer = await readStoredObject(row.objectKey);
  return { buffer, mimeType: row.mimeType, originalName: row.originalName };
}

export async function getMediaFileForEmployee(session: EmployeeSessionContext, fileId: string) {
  const [row] = await getDb()
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.organizationId, session.organizationId)))
    .limit(1);
  if (!row || row.status !== "ready") throw new AppError("NOT_FOUND", "File not found.");

  const [versionMatch] = await getDb()
    .select({ id: sopVersions.id })
    .from(sops)
    .innerJoin(
      sopVersions,
      and(
        eq(sopVersions.id, sops.currentVersionId),
        eq(sopVersions.organizationId, sops.organizationId),
      ),
    )
    .where(
      and(
        eq(sops.organizationId, session.organizationId),
        eq(sops.locationId, session.locationId),
        eq(sops.status, "published"),
        or(eq(sopVersions.coverImageFileId, fileId), eq(sopVersions.sourceVideoFileId, fileId)),
      ),
    )
    .limit(1);
  const [stepMatch] = versionMatch
    ? []
    : await getDb()
        .select({ id: sopSteps.id })
        .from(sops)
        .innerJoin(
          sopVersions,
          and(
            eq(sopVersions.id, sops.currentVersionId),
            eq(sopVersions.organizationId, sops.organizationId),
          ),
        )
        .innerJoin(sopSteps, eq(sopSteps.sopVersionId, sopVersions.id))
        .where(
          and(
            eq(sops.organizationId, session.organizationId),
            eq(sops.locationId, session.locationId),
            eq(sops.status, "published"),
            or(eq(sopSteps.imageFileId, fileId), eq(sopSteps.videoFileId, fileId)),
          ),
        )
        .limit(1);
  const [assignedVersionStepMatch] =
    versionMatch || stepMatch
      ? []
      : await getDb()
          .select({ id: sopSteps.id })
          .from(trainingAssignments)
          .innerJoin(
            sopSteps,
            and(
              eq(sopSteps.sopVersionId, trainingAssignments.sopVersionId),
              eq(sopSteps.organizationId, trainingAssignments.organizationId),
            ),
          )
          .where(
            and(
              eq(trainingAssignments.organizationId, session.organizationId),
              eq(trainingAssignments.employeeId, session.employeeId),
              or(eq(sopSteps.imageFileId, fileId), eq(sopSteps.videoFileId, fileId)),
            ),
          )
          .limit(1);
  const isOwnEvidence = row.uploaderEmployeeId === session.employeeId;
  if (!versionMatch && !stepMatch && !assignedVersionStepMatch && !isOwnEvidence) {
    throw new AppError("NOT_FOUND", "File not found.");
  }

  const buffer = await readStoredObject(row.objectKey);
  return { buffer, mimeType: row.mimeType, originalName: row.originalName };
}
