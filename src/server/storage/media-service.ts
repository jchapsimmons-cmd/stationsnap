import { createHash, randomUUID } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { writeAuditEvent } from "@/server/audit";
import type { EmployeeSessionContext, ManagerSessionContext } from "@/server/auth/sessions";
import { getDb } from "@/server/db/client";
import { files, sops, sopSteps, sopVersions } from "@/server/db/schema";
import { maxBytesForMediaType, mediaTypeForMime } from "@/server/storage/constants";
import { createObjectKey, readStoredObject, writeStoredObject } from "@/server/storage/driver";

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\r\n"]/g, "").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 200) : "upload";
}

export async function uploadMedia(
  actor: ManagerSessionContext,
  formData: FormData,
  requestId?: string,
) {
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
  const checksum = createHash("sha256").update(buffer).digest("hex");
  const objectKey = createObjectKey(actor.organizationId);
  await writeStoredObject(objectKey, buffer);

  const [row] = await getDb()
    .insert(files)
    .values({
      id: randomUUID(),
      organizationId: actor.organizationId,
      uploaderManagerUserId: actor.managerUserId,
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

  await writeAuditEvent({
    organizationId: actor.organizationId,
    actorKind: "manager",
    actorId: actor.managerUserId,
    action: "media.uploaded",
    targetType: "file",
    targetId: row.id,
    metadata: { mediaType, byteSize: row.byteSize },
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
  if (!versionMatch && !stepMatch) throw new AppError("NOT_FOUND", "File not found.");

  const buffer = await readStoredObject(row.objectKey);
  return { buffer, mimeType: row.mimeType, originalName: row.originalName };
}
