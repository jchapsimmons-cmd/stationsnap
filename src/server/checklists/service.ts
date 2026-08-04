import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { writeAuditEvent } from "@/server/audit";
import { requireManagerManagedLocation } from "@/server/auth/authorization";
import type { EmployeeSessionContext, ManagerSessionContext } from "@/server/auth/sessions";
import type {
  ChecklistCreateInput,
  ChecklistItemInput,
  ChecklistQuery,
  ChecklistUpdateInput,
} from "@/server/checklists/schemas";
import { getDb } from "@/server/db/client";
import {
  checklistItemProgress,
  checklistItems,
  checklists,
  files,
  locations,
  stations,
} from "@/server/db/schema";
import { getManagedLocationIds, requireActiveManagedLocation } from "@/server/management/service";

function postgresCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? postgresCode(error.cause) : undefined;
}

async function mapConflicts<T>(operation: () => Promise<T>, message: string): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (postgresCode(error) === "23505") throw new AppError("CONFLICT", message);
    throw error;
  }
}

async function assertStationInLocation(
  organizationId: string,
  stationId: string,
  locationId: string,
): Promise<void> {
  const [row] = await getDb()
    .select({ id: stations.id })
    .from(stations)
    .where(
      and(
        eq(stations.id, stationId),
        eq(stations.organizationId, organizationId),
        eq(stations.locationId, locationId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new AppError("BAD_REQUEST", "Choose a station that belongs to this location.");
  }
}

async function assertFileReady(organizationId: string, fileId: string): Promise<void> {
  const [row] = await getDb()
    .select({ status: files.status })
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.organizationId, organizationId)))
    .limit(1);
  if (!row || row.status !== "ready") {
    throw new AppError("BAD_REQUEST", "Finish uploading the media before saving.");
  }
}

async function assertItemFilesReady(
  organizationId: string,
  items: readonly ChecklistItemInput[],
): Promise<void> {
  for (const item of items) {
    if (item.referenceFileId) await assertFileReady(organizationId, item.referenceFileId);
  }
}

async function auditChecklistMutation(
  actor: ManagerSessionContext,
  action: "checklist.created" | "checklist.updated",
  checklistId: string,
  locationId: string,
  requestId?: string,
): Promise<void> {
  await writeAuditEvent({
    organizationId: actor.organizationId,
    locationId,
    actorKind: "manager",
    actorId: actor.managerUserId,
    action,
    targetType: "checklist",
    targetId: checklistId,
    requestId,
  });
}

/**
 * Manager checklist library, scoped exactly like `listPaths`/`listApprovalQueue`: owners see the
 * whole organization, restricted managers only their permitted locations, and a location filter
 * can narrow that scope but never widen it.
 */
export async function listChecklists(actor: ManagerSessionContext, query: ChecklistQuery) {
  const managedIds = await getManagedLocationIds(actor);
  if (managedIds.length === 0) return [];
  if (query.locationId && !managedIds.includes(query.locationId)) return [];

  const conditions = [
    eq(checklists.organizationId, actor.organizationId),
    inArray(checklists.locationId, query.locationId ? [query.locationId] : managedIds),
  ];
  if (query.status) conditions.push(eq(checklists.status, query.status));
  if (query.type) conditions.push(eq(checklists.type, query.type));

  return getDb()
    .select({
      id: checklists.id,
      title: checklists.title,
      type: checklists.type,
      recurrenceType: checklists.recurrenceType,
      status: checklists.status,
      locationId: checklists.locationId,
      locationName: locations.name,
      stationId: checklists.stationId,
      stationName: stations.name,
      updatedAt: checklists.updatedAt,
    })
    .from(checklists)
    .innerJoin(
      locations,
      and(
        eq(locations.id, checklists.locationId),
        eq(locations.organizationId, checklists.organizationId),
      ),
    )
    .leftJoin(
      stations,
      and(
        eq(stations.id, checklists.stationId),
        eq(stations.organizationId, checklists.organizationId),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(checklists.updatedAt))
    .limit(300);
}

export async function countChecklistItems(
  organizationId: string,
  checklistIds: readonly string[],
): Promise<Map<string, number>> {
  if (checklistIds.length === 0) return new Map();
  const rows = await getDb()
    .select({ checklistId: checklistItems.checklistId, count: sql<number>`count(*)::int` })
    .from(checklistItems)
    .where(
      and(
        eq(checklistItems.organizationId, organizationId),
        inArray(checklistItems.checklistId, [...checklistIds]),
        eq(checklistItems.status, "active"),
      ),
    )
    .groupBy(checklistItems.checklistId);
  return new Map(rows.map((row) => [row.checklistId, row.count]));
}

async function loadChecklistRow(organizationId: string, checklistId: string) {
  const [row] = await getDb()
    .select()
    .from(checklists)
    .where(and(eq(checklists.id, checklistId), eq(checklists.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Checklist not found.");
  return row;
}

async function loadActiveItems(organizationId: string, checklistId: string) {
  return getDb()
    .select()
    .from(checklistItems)
    .where(
      and(
        eq(checklistItems.organizationId, organizationId),
        eq(checklistItems.checklistId, checklistId),
        eq(checklistItems.status, "active"),
      ),
    )
    .orderBy(checklistItems.displayOrder);
}

/** Full checklist detail for the manager library: the definition plus its active, ordered items. */
export async function getChecklistDetail(actor: ManagerSessionContext, checklistId: string) {
  const row = await loadChecklistRow(actor.organizationId, checklistId);
  await requireManagerManagedLocation(actor, row.locationId);
  const items = await loadActiveItems(actor.organizationId, checklistId);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    recurrenceType: row.recurrenceType,
    status: row.status,
    locationId: row.locationId,
    stationId: row.stationId,
    updatedAt: row.updatedAt,
    items: items.map((item) => ({
      id: item.id,
      displayOrder: item.displayOrder,
      title: item.title,
      instructions: item.instructions,
      isRequired: item.isRequired,
      timerSeconds: item.timerSeconds,
      requirePhoto: item.requirePhoto,
      requireApproval: item.requireApproval,
      requireNote: item.requireNote,
      referenceFileId: item.referenceFileId,
    })),
  };
}

export async function createChecklist(
  actor: ManagerSessionContext,
  input: ChecklistCreateInput,
  requestId?: string,
) {
  await requireActiveManagedLocation(actor, input.locationId, requestId);
  if (input.stationId) {
    await assertStationInLocation(actor.organizationId, input.stationId, input.locationId);
  }
  await assertItemFilesReady(actor.organizationId, input.items);

  const checklistId = randomUUID();
  await mapConflicts(
    () =>
      getDb().transaction(async (tx) => {
        await tx.insert(checklists).values({
          id: checklistId,
          organizationId: actor.organizationId,
          locationId: input.locationId,
          stationId: input.stationId,
          type: input.type,
          title: input.title,
          description: input.description,
          recurrenceType: input.recurrenceType,
          status: input.status,
          createdByManagerUserId: actor.managerUserId,
        });
        await tx.insert(checklistItems).values(
          input.items.map((item, index) => ({
            id: randomUUID(),
            organizationId: actor.organizationId,
            checklistId,
            displayOrder: index + 1,
            title: item.title,
            instructions: item.instructions,
            isRequired: item.isRequired,
            timerSeconds: item.timerSeconds,
            requirePhoto: item.requirePhoto,
            requireApproval: item.requireApproval,
            requireNote: item.requireNote,
            referenceFileId: item.referenceFileId,
          })),
        );
      }),
    "A checklist with that title already exists at this location.",
  );

  await auditChecklistMutation(
    actor,
    "checklist.created",
    checklistId,
    input.locationId,
    requestId,
  );
  return getChecklistDetail(actor, checklistId);
}

/**
 * Updates a checklist's fields and reconciles its items against `input.items`: items carrying a
 * known `id` are updated in place, items without one (or with an unknown id) are inserted fresh,
 * and existing items missing from `input` are removed only if no run has ever recorded progress
 * against them — otherwise they are disabled rather than deleted, since `checklist_item_progress`
 * holds a restrict-on-delete foreign key to preserve historical runs' item references.
 */
export async function updateChecklist(
  actor: ManagerSessionContext,
  checklistId: string,
  input: ChecklistUpdateInput,
  requestId?: string,
) {
  const current = await getChecklistDetail(actor, checklistId);
  await assertItemFilesReady(actor.organizationId, input.items);

  await mapConflicts(
    () =>
      getDb().transaction(async (tx) => {
        await tx
          .update(checklists)
          .set({
            title: input.title,
            description: input.description,
            type: input.type,
            recurrenceType: input.recurrenceType,
            status: input.status,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(checklists.id, checklistId),
              eq(checklists.organizationId, actor.organizationId),
            ),
          );

        const existingIds = new Set(current.items.map((item) => item.id));
        const keptIds = new Set<string>();

        for (const [index, item] of input.items.entries()) {
          if (item.id && existingIds.has(item.id)) {
            keptIds.add(item.id);
            await tx
              .update(checklistItems)
              .set({
                displayOrder: index + 1,
                title: item.title,
                instructions: item.instructions,
                isRequired: item.isRequired,
                timerSeconds: item.timerSeconds,
                requirePhoto: item.requirePhoto,
                requireApproval: item.requireApproval,
                requireNote: item.requireNote,
                referenceFileId: item.referenceFileId,
                status: "active",
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(checklistItems.id, item.id),
                  eq(checklistItems.organizationId, actor.organizationId),
                ),
              );
          } else {
            const newId = randomUUID();
            keptIds.add(newId);
            await tx.insert(checklistItems).values({
              id: newId,
              organizationId: actor.organizationId,
              checklistId,
              displayOrder: index + 1,
              title: item.title,
              instructions: item.instructions,
              isRequired: item.isRequired,
              timerSeconds: item.timerSeconds,
              requirePhoto: item.requirePhoto,
              requireApproval: item.requireApproval,
              requireNote: item.requireNote,
              referenceFileId: item.referenceFileId,
            });
          }
        }

        const removedIds = current.items.map((item) => item.id).filter((id) => !keptIds.has(id));
        if (removedIds.length > 0) {
          const referenced = await tx
            .select({ itemId: checklistItemProgress.itemId })
            .from(checklistItemProgress)
            .where(
              and(
                eq(checklistItemProgress.organizationId, actor.organizationId),
                inArray(checklistItemProgress.itemId, removedIds),
              ),
            )
            .groupBy(checklistItemProgress.itemId);
          const referencedIds = new Set(referenced.map((row) => row.itemId));
          const deletableIds = removedIds.filter((id) => !referencedIds.has(id));
          const disableIds = removedIds.filter((id) => referencedIds.has(id));

          if (deletableIds.length > 0) {
            await tx
              .delete(checklistItems)
              .where(
                and(
                  eq(checklistItems.organizationId, actor.organizationId),
                  inArray(checklistItems.id, deletableIds),
                ),
              );
          }
          if (disableIds.length > 0) {
            await tx
              .update(checklistItems)
              .set({ status: "disabled", updatedAt: new Date() })
              .where(
                and(
                  eq(checklistItems.organizationId, actor.organizationId),
                  inArray(checklistItems.id, disableIds),
                ),
              );
          }
        }
      }),
    "A checklist with that title already exists at this location.",
  );

  await auditChecklistMutation(
    actor,
    "checklist.updated",
    checklistId,
    current.locationId,
    requestId,
  );
  return getChecklistDetail(actor, checklistId);
}

/** Active checklists available at the employee's own location, for the browse view. */
export async function listChecklistsForEmployee(session: EmployeeSessionContext) {
  return getDb()
    .select({
      id: checklists.id,
      title: checklists.title,
      description: checklists.description,
      type: checklists.type,
      recurrenceType: checklists.recurrenceType,
      stationId: checklists.stationId,
      stationName: stations.name,
    })
    .from(checklists)
    .leftJoin(
      stations,
      and(
        eq(stations.id, checklists.stationId),
        eq(stations.organizationId, checklists.organizationId),
      ),
    )
    .where(
      and(
        eq(checklists.organizationId, session.organizationId),
        eq(checklists.locationId, session.locationId),
        eq(checklists.status, "active"),
      ),
    )
    .orderBy(checklists.title);
}

export async function getChecklistForEmployee(
  session: EmployeeSessionContext,
  checklistId: string,
) {
  const [row] = await getDb()
    .select()
    .from(checklists)
    .where(
      and(
        eq(checklists.id, checklistId),
        eq(checklists.organizationId, session.organizationId),
        eq(checklists.locationId, session.locationId),
        eq(checklists.status, "active"),
      ),
    )
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Checklist not found.");
  const items = await loadActiveItems(session.organizationId, checklistId);
  return { checklist: row, items };
}
