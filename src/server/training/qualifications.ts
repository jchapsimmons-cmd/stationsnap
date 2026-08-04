import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, desc } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { writeAuditEvent } from "@/server/audit";
import { requireManagerManagedLocation } from "@/server/auth/authorization";
import type { EmployeeSessionContext, ManagerSessionContext } from "@/server/auth/sessions";
import { getDb } from "@/server/db/client";
import {
  employeeQualifications,
  employees,
  locations,
  qualificationDefinitions,
  qualificationSupportingSessions,
  sops,
  sopVersions,
  stations,
  trainingAssignments,
  trainingPathItems,
  trainingPaths,
  trainingSessions,
} from "@/server/db/schema";
import { getManagedLocationIds, requireActiveManagedLocation } from "@/server/management/service";
import type {
  QualificationOverviewQuery,
  TrainingPathCreateInput,
  TrainingPathItemInput,
  TrainingPathQuery,
  TrainingPathUpdateInput,
} from "@/server/training/paths-schemas";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

// Cross-cutting "expiring soon" window used by the overview and employee views. This is a fixed
// simplification for this phase — qualification_definitions has no separate configurable
// "expiring soon" threshold — not a value a manager can tune per definition.
const EXPIRING_SOON_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

async function auditPathMutation(
  actor: ManagerSessionContext,
  action: "training_path.created" | "training_path.updated",
  pathId: string,
  locationId: string,
  requestId?: string,
): Promise<void> {
  await writeAuditEvent({
    organizationId: actor.organizationId,
    locationId,
    actorKind: "manager",
    actorId: actor.managerUserId,
    action,
    targetType: "training_path",
    targetId: pathId,
    requestId,
  });
}

/* ------------------------------------------------------------------------------------------- */
/* Pure, DB-free helpers (exported so they can be unit tested without a database)                */
/* ------------------------------------------------------------------------------------------- */

/**
 * True when a required path item's resolved completion timestamps are non-decreasing in
 * `displayOrder` order — the "ordered path blocking" invariant: an item at a later position must
 * complete at or after every item before it, even though each item individually has *a* passing
 * completion.
 */
export function isOrderSatisfied(entries: { displayOrder: number; completedAt: Date }[]): boolean {
  const sorted = [...entries].sort((left, right) => left.displayOrder - right.displayOrder);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (!previous || !current) continue;
    if (current.completedAt.getTime() < previous.completedAt.getTime()) return false;
  }
  return true;
}

export type QualificationClassification = "qualified" | "training" | "missing" | "expired";

/**
 * Derives an employee's qualification classification and "expiring soon" flag from immutable
 * facts and the current time — never from a stored status. Shared by the manager overview and
 * the employee-facing views so the rules are expressed exactly once.
 */
export function classifyQualification(params: {
  hasActiveEpisode: boolean;
  expiresAt: Date | null;
  hasNonTerminalTraining: boolean;
  now?: Date;
}): { classification: QualificationClassification; isExpiringSoon: boolean } {
  const now = params.now ?? new Date();
  if (params.hasActiveEpisode) {
    const expired = params.expiresAt !== null && params.expiresAt.getTime() <= now.getTime();
    if (expired) return { classification: "expired", isExpiringSoon: false };
    const isExpiringSoon =
      params.expiresAt !== null &&
      params.expiresAt.getTime() - now.getTime() <= EXPIRING_SOON_WINDOW_MS;
    return { classification: "qualified", isExpiringSoon };
  }
  return {
    classification: params.hasNonTerminalTraining ? "training" : "missing",
    isExpiringSoon: false,
  };
}

function expiresAtFromValidityDays(now: Date, defaultValidityDays: number | null): Date | null {
  if (defaultValidityDays === null) return null;
  return new Date(now.getTime() + defaultValidityDays * MS_PER_DAY);
}

/* ------------------------------------------------------------------------------------------- */
/* Award algorithm                                                                                */
/* ------------------------------------------------------------------------------------------- */

export interface QualificationAwardOutcome {
  qualificationId: string;
  definitionId: string;
  employeeId: string;
  isNewAward: boolean;
}

interface ResolvedItemCompletion {
  sessionId: string;
  completedAt: Date;
  displayOrder: number;
}

/** The employee's best qualifying completion for one required path item, or null if none exists. */
async function resolveBestCompletion(
  tx: Tx,
  organizationId: string,
  employeeId: string,
  sopId: string,
  versionPolicy: "current_version" | "any_passed_version",
): Promise<{ sessionId: string; completedAt: Date } | null> {
  const conditions = [
    eq(trainingAssignments.organizationId, organizationId),
    eq(trainingAssignments.employeeId, employeeId),
    eq(trainingAssignments.status, "completed"),
    eq(sopVersions.sopId, sopId),
    eq(trainingSessions.status, "passed"),
  ];
  if (versionPolicy === "current_version") {
    const [sopRow] = await tx
      .select({ currentVersionId: sops.currentVersionId })
      .from(sops)
      .where(and(eq(sops.id, sopId), eq(sops.organizationId, organizationId)))
      .limit(1);
    if (!sopRow?.currentVersionId) return null;
    conditions.push(eq(trainingAssignments.sopVersionId, sopRow.currentVersionId));
  }

  const [row] = await tx
    .select({
      sessionId: trainingSessions.id,
      completedAt: trainingSessions.completedAt,
    })
    .from(trainingAssignments)
    .innerJoin(
      sopVersions,
      and(
        eq(sopVersions.id, trainingAssignments.sopVersionId),
        eq(sopVersions.organizationId, trainingAssignments.organizationId),
      ),
    )
    .innerJoin(
      trainingSessions,
      and(
        eq(trainingSessions.assignmentId, trainingAssignments.id),
        eq(trainingSessions.organizationId, trainingAssignments.organizationId),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(trainingSessions.completedAt))
    .limit(1);
  if (!row || !row.completedAt) return null;
  return { sessionId: row.sessionId, completedAt: row.completedAt };
}

/**
 * Runs inside an existing transaction, immediately after an assignment transitions to
 * `status: "completed"`. Finds every active training path that references `sopId`, checks whether
 * the employee now satisfies every one of that path's required items (respecting each item's
 * version-resolution policy and, when `enforceOrder` is set, the order the required items were
 * completed in), and awards or renews the corresponding qualification.
 *
 * Renewal note: `qualification_status` deliberately has no "expired" value — expiry is always
 * derived by comparing `expiresAt` to now, never persisted. Because of that, a naturally-lapsed
 * episode is still the one row carrying `status: "active"` for its employee/definition pair (the
 * partial unique index enforces at most one), so this function always looks up "the existing
 * active-status row" by status alone and reuses it for a fresh award — never inserts a second
 * `active` row while one already exists. A brand-new row is only ever inserted when there is
 * truly no active-status row: the first award ever, or the prior episode was explicitly revoked.
 */
export async function evaluateAndAwardQualifications(
  tx: Tx,
  organizationId: string,
  employeeId: string,
  sopId: string,
): Promise<QualificationAwardOutcome[]> {
  const now = new Date();
  const outcomes: QualificationAwardOutcome[] = [];

  const candidatePaths = await tx
    .selectDistinct({
      pathId: trainingPaths.id,
      qualificationDefinitionId: trainingPaths.qualificationDefinitionId,
      enforceOrder: trainingPaths.enforceOrder,
    })
    .from(trainingPathItems)
    .innerJoin(
      trainingPaths,
      and(
        eq(trainingPaths.id, trainingPathItems.pathId),
        eq(trainingPaths.organizationId, trainingPathItems.organizationId),
      ),
    )
    .where(
      and(
        eq(trainingPathItems.organizationId, organizationId),
        eq(trainingPathItems.sopId, sopId),
        eq(trainingPaths.status, "active"),
      ),
    );

  for (const path of candidatePaths) {
    const requiredItems = await tx
      .select({
        sopId: trainingPathItems.sopId,
        displayOrder: trainingPathItems.displayOrder,
        versionPolicy: trainingPathItems.versionPolicy,
      })
      .from(trainingPathItems)
      .where(
        and(
          eq(trainingPathItems.pathId, path.pathId),
          eq(trainingPathItems.organizationId, organizationId),
          eq(trainingPathItems.isRequired, true),
        ),
      )
      .orderBy(asc(trainingPathItems.displayOrder));
    if (requiredItems.length === 0) continue;

    const resolved: ResolvedItemCompletion[] = [];
    let satisfied = true;
    for (const item of requiredItems) {
      const completion = await resolveBestCompletion(
        tx,
        organizationId,
        employeeId,
        item.sopId,
        item.versionPolicy,
      );
      if (!completion) {
        satisfied = false;
        break;
      }
      resolved.push({
        sessionId: completion.sessionId,
        completedAt: completion.completedAt,
        displayOrder: item.displayOrder,
      });
    }
    if (!satisfied) continue;
    if (path.enforceOrder && !isOrderSatisfied(resolved)) continue;

    const [definitionRow] = await tx
      .select({ defaultValidityDays: qualificationDefinitions.defaultValidityDays })
      .from(qualificationDefinitions)
      .where(
        and(
          eq(qualificationDefinitions.id, path.qualificationDefinitionId),
          eq(qualificationDefinitions.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!definitionRow) continue;

    const newSessionIds = new Set(resolved.map((entry) => entry.sessionId));

    const [existingActive] = await tx
      .select()
      .from(employeeQualifications)
      .where(
        and(
          eq(employeeQualifications.organizationId, organizationId),
          eq(employeeQualifications.employeeId, employeeId),
          eq(employeeQualifications.definitionId, path.qualificationDefinitionId),
          eq(employeeQualifications.status, "active"),
        ),
      )
      .limit(1);

    const expiresAt = expiresAtFromValidityDays(now, definitionRow.defaultValidityDays);

    if (existingActive) {
      const existingSessionRows = await tx
        .select({ sessionId: qualificationSupportingSessions.sessionId })
        .from(qualificationSupportingSessions)
        .where(
          and(
            eq(qualificationSupportingSessions.organizationId, organizationId),
            eq(qualificationSupportingSessions.qualificationId, existingActive.id),
          ),
        );
      const existingSessionIds = new Set(existingSessionRows.map((row) => row.sessionId));
      const sameSet =
        existingSessionIds.size === newSessionIds.size &&
        [...existingSessionIds].every((id) => newSessionIds.has(id));
      if (sameSet) continue; // Already awarded with these exact sessions — idempotent no-op.

      await tx
        .update(employeeQualifications)
        .set({
          sourcePathId: path.pathId,
          awardedAt: now,
          expiresAt,
          updatedAt: now,
        })
        .where(
          and(
            eq(employeeQualifications.id, existingActive.id),
            eq(employeeQualifications.organizationId, organizationId),
          ),
        );
      await tx
        .delete(qualificationSupportingSessions)
        .where(
          and(
            eq(qualificationSupportingSessions.organizationId, organizationId),
            eq(qualificationSupportingSessions.qualificationId, existingActive.id),
          ),
        );
      await tx.insert(qualificationSupportingSessions).values(
        resolved.map((entry) => ({
          id: randomUUID(),
          organizationId,
          qualificationId: existingActive.id,
          sessionId: entry.sessionId,
        })),
      );
      outcomes.push({
        qualificationId: existingActive.id,
        definitionId: path.qualificationDefinitionId,
        employeeId,
        isNewAward: false,
      });
    } else {
      const qualificationId = randomUUID();
      await tx.insert(employeeQualifications).values({
        id: qualificationId,
        organizationId,
        employeeId,
        definitionId: path.qualificationDefinitionId,
        sourcePathId: path.pathId,
        awardedAt: now,
        expiresAt,
        status: "active",
      });
      await tx.insert(qualificationSupportingSessions).values(
        resolved.map((entry) => ({
          id: randomUUID(),
          organizationId,
          qualificationId,
          sessionId: entry.sessionId,
        })),
      );
      outcomes.push({
        qualificationId,
        definitionId: path.qualificationDefinitionId,
        employeeId,
        isNewAward: true,
      });
    }
  }

  return outcomes;
}

/* ------------------------------------------------------------------------------------------- */
/* Revocation                                                                                     */
/* ------------------------------------------------------------------------------------------- */

export async function revokeQualification(
  actor: ManagerSessionContext,
  qualificationId: string,
  note: string,
  requestId?: string,
) {
  const [row] = await getDb()
    .select({
      qualification: employeeQualifications,
      locationId: qualificationDefinitions.locationId,
    })
    .from(employeeQualifications)
    .innerJoin(
      qualificationDefinitions,
      and(
        eq(qualificationDefinitions.id, employeeQualifications.definitionId),
        eq(qualificationDefinitions.organizationId, employeeQualifications.organizationId),
      ),
    )
    .where(
      and(
        eq(employeeQualifications.id, qualificationId),
        eq(employeeQualifications.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Qualification not found.");
  await requireManagerManagedLocation(actor, row.locationId, requestId);
  if (row.qualification.status !== "active") {
    throw new AppError("CONFLICT", "This qualification has already been revoked.");
  }

  const now = new Date();
  const [updated] = await getDb()
    .update(employeeQualifications)
    .set({
      status: "revoked",
      revokedAt: now,
      revokedByManagerUserId: actor.managerUserId,
      revokedNote: note,
      updatedAt: now,
    })
    .where(
      and(
        eq(employeeQualifications.id, qualificationId),
        eq(employeeQualifications.organizationId, actor.organizationId),
        eq(employeeQualifications.status, "active"),
      ),
    )
    .returning({ id: employeeQualifications.id });
  if (!updated) throw new AppError("CONFLICT", "This qualification has already been revoked.");

  await writeAuditEvent({
    organizationId: actor.organizationId,
    locationId: row.locationId,
    actorKind: "manager",
    actorId: actor.managerUserId,
    action: "qualification.revoked",
    targetType: "employee_qualification",
    targetId: qualificationId,
    requestId,
  });

  return getQualificationDetail(actor, qualificationId);
}

/* ------------------------------------------------------------------------------------------- */
/* Manager reads and path CRUD                                                                   */
/* ------------------------------------------------------------------------------------------- */

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
    throw new AppError("BAD_REQUEST", "That station is not part of the selected location.");
  }
}

/** Every SOP added to a path must be published and belong to the path's own location. */
async function assertPathItemsValid(
  organizationId: string,
  locationId: string,
  items: TrainingPathItemInput[],
): Promise<void> {
  const sopIds = items.map((item) => item.sopId);
  const rows = await getDb()
    .select({
      id: sops.id,
      locationId: sops.locationId,
      status: sops.status,
      currentVersionId: sops.currentVersionId,
    })
    .from(sops)
    .where(and(eq(sops.organizationId, organizationId), inArray(sops.id, sopIds)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const item of items) {
    const sop = byId.get(item.sopId);
    if (!sop) throw new AppError("BAD_REQUEST", "One or more selected SOPs were not found.");
    if (sop.status !== "published" || !sop.currentVersionId) {
      throw new AppError("BAD_REQUEST", "Every SOP in a training path must be published.");
    }
    if (sop.locationId !== locationId) {
      throw new AppError(
        "BAD_REQUEST",
        "Every SOP in a training path must belong to the path's own location.",
      );
    }
  }
}

export async function listPaths(actor: ManagerSessionContext, query: TrainingPathQuery) {
  const managedIds = await getManagedLocationIds(actor);
  if (managedIds.length === 0) return [];
  if (query.locationId && !managedIds.includes(query.locationId)) return [];
  const conditions = [
    eq(trainingPaths.organizationId, actor.organizationId),
    inArray(trainingPaths.locationId, query.locationId ? [query.locationId] : managedIds),
  ];
  if (query.status) conditions.push(eq(trainingPaths.status, query.status));
  return getDb()
    .select({
      id: trainingPaths.id,
      title: trainingPaths.title,
      description: trainingPaths.description,
      locationId: trainingPaths.locationId,
      locationName: locations.name,
      stationId: trainingPaths.stationId,
      stationName: stations.name,
      enforceOrder: trainingPaths.enforceOrder,
      status: trainingPaths.status,
      qualificationDefinitionId: trainingPaths.qualificationDefinitionId,
      definitionName: qualificationDefinitions.name,
      createdAt: trainingPaths.createdAt,
    })
    .from(trainingPaths)
    .innerJoin(
      locations,
      and(
        eq(locations.id, trainingPaths.locationId),
        eq(locations.organizationId, trainingPaths.organizationId),
      ),
    )
    .leftJoin(
      stations,
      and(
        eq(stations.id, trainingPaths.stationId),
        eq(stations.organizationId, trainingPaths.organizationId),
      ),
    )
    .innerJoin(
      qualificationDefinitions,
      and(
        eq(qualificationDefinitions.id, trainingPaths.qualificationDefinitionId),
        eq(qualificationDefinitions.organizationId, trainingPaths.organizationId),
      ),
    )
    .where(and(...conditions))
    .orderBy(asc(locations.name), asc(trainingPaths.title));
}

async function summarizeQualificationCounts(organizationId: string, definitionId: string) {
  const rows = await getDb()
    .select({ status: employeeQualifications.status, expiresAt: employeeQualifications.expiresAt })
    .from(employeeQualifications)
    .where(
      and(
        eq(employeeQualifications.organizationId, organizationId),
        eq(employeeQualifications.definitionId, definitionId),
      ),
    );
  const now = Date.now();
  let active = 0;
  let revoked = 0;
  let expired = 0;
  for (const row of rows) {
    if (row.status === "revoked") {
      revoked += 1;
      continue;
    }
    if (row.expiresAt && row.expiresAt.getTime() <= now) {
      expired += 1;
      continue;
    }
    active += 1;
  }
  return { active, revoked, expired };
}

export async function getPathDetail(actor: ManagerSessionContext, pathId: string) {
  const [row] = await getDb()
    .select({
      path: trainingPaths,
      definition: qualificationDefinitions,
      locationName: locations.name,
      stationName: stations.name,
    })
    .from(trainingPaths)
    .innerJoin(
      qualificationDefinitions,
      and(
        eq(qualificationDefinitions.id, trainingPaths.qualificationDefinitionId),
        eq(qualificationDefinitions.organizationId, trainingPaths.organizationId),
      ),
    )
    .innerJoin(
      locations,
      and(
        eq(locations.id, trainingPaths.locationId),
        eq(locations.organizationId, trainingPaths.organizationId),
      ),
    )
    .leftJoin(
      stations,
      and(
        eq(stations.id, trainingPaths.stationId),
        eq(stations.organizationId, trainingPaths.organizationId),
      ),
    )
    .where(
      and(eq(trainingPaths.id, pathId), eq(trainingPaths.organizationId, actor.organizationId)),
    )
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Training path not found.");
  await requireManagerManagedLocation(actor, row.path.locationId);

  const items = await getDb()
    .select({
      id: trainingPathItems.id,
      sopId: trainingPathItems.sopId,
      sopTitle: sopVersions.title,
      sopCategory: sops.category,
      isRequired: trainingPathItems.isRequired,
      displayOrder: trainingPathItems.displayOrder,
      versionPolicy: trainingPathItems.versionPolicy,
    })
    .from(trainingPathItems)
    .innerJoin(
      sops,
      and(
        eq(sops.id, trainingPathItems.sopId),
        eq(sops.organizationId, trainingPathItems.organizationId),
      ),
    )
    .leftJoin(
      sopVersions,
      and(
        eq(sopVersions.id, sops.currentVersionId),
        eq(sopVersions.organizationId, sops.organizationId),
      ),
    )
    .where(
      and(
        eq(trainingPathItems.pathId, pathId),
        eq(trainingPathItems.organizationId, actor.organizationId),
      ),
    )
    .orderBy(asc(trainingPathItems.displayOrder));

  const qualificationSummary = await summarizeQualificationCounts(
    actor.organizationId,
    row.definition.id,
  );

  return {
    id: row.path.id,
    title: row.path.title,
    description: row.path.description,
    locationId: row.path.locationId,
    locationName: row.locationName,
    stationId: row.path.stationId,
    stationName: row.stationName,
    enforceOrder: row.path.enforceOrder,
    status: row.path.status,
    definition: {
      id: row.definition.id,
      name: row.definition.name,
      description: row.definition.description,
      defaultValidityDays: row.definition.defaultValidityDays,
      status: row.definition.status,
    },
    items,
    qualificationSummary,
  };
}

/**
 * Creates the 1:1 qualification definition and training path together, in one transaction, then
 * fully replaces the path's items (there is nothing to replace yet on create, but the same helper
 * shape is reused by `updatePath`).
 */
export async function createPath(
  actor: ManagerSessionContext,
  input: TrainingPathCreateInput,
  requestId?: string,
) {
  await requireActiveManagedLocation(actor, input.locationId, requestId);
  if (input.stationId) {
    await assertStationInLocation(actor.organizationId, input.stationId, input.locationId);
  }
  await assertPathItemsValid(actor.organizationId, input.locationId, input.items);

  const pathId = randomUUID();
  const definitionId = randomUUID();

  await mapConflicts(
    () =>
      getDb().transaction(async (tx) => {
        await tx.insert(qualificationDefinitions).values({
          id: definitionId,
          organizationId: actor.organizationId,
          locationId: input.locationId,
          stationId: input.stationId,
          name: input.definition.name,
          description: input.definition.description,
          defaultValidityDays: input.definition.defaultValidityDays,
          status: input.status,
        });
        await tx.insert(trainingPaths).values({
          id: pathId,
          organizationId: actor.organizationId,
          locationId: input.locationId,
          stationId: input.stationId,
          qualificationDefinitionId: definitionId,
          title: input.title,
          description: input.description,
          enforceOrder: input.enforceOrder,
          status: input.status,
        });
        await tx.insert(trainingPathItems).values(
          input.items.map((item, index) => ({
            id: randomUUID(),
            organizationId: actor.organizationId,
            pathId,
            sopId: item.sopId,
            isRequired: item.isRequired,
            displayOrder: index + 1,
            versionPolicy: item.versionPolicy,
          })),
        );
      }),
    "A training path or qualification with that name already exists at this location.",
  );

  await auditPathMutation(actor, "training_path.created", pathId, input.locationId, requestId);
  return getPathDetail(actor, pathId);
}

/**
 * Updates a path's title/description/order-enforcement/status, its 1:1 definition's editable
 * fields, and fully replaces its items (delete-all-then-reinsert). `locationId`/`stationId` are
 * immutable after creation, so `input` has no such fields to accept.
 */
export async function updatePath(
  actor: ManagerSessionContext,
  pathId: string,
  input: TrainingPathUpdateInput,
  requestId?: string,
) {
  const current = await getPathDetail(actor, pathId);
  await assertPathItemsValid(actor.organizationId, current.locationId, input.items);

  await mapConflicts(
    () =>
      getDb().transaction(async (tx) => {
        await tx
          .update(qualificationDefinitions)
          .set({
            name: input.definition.name,
            description: input.definition.description,
            defaultValidityDays: input.definition.defaultValidityDays,
            status: input.status,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(qualificationDefinitions.id, current.definition.id),
              eq(qualificationDefinitions.organizationId, actor.organizationId),
            ),
          );
        await tx
          .update(trainingPaths)
          .set({
            title: input.title,
            description: input.description,
            enforceOrder: input.enforceOrder,
            status: input.status,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(trainingPaths.id, pathId),
              eq(trainingPaths.organizationId, actor.organizationId),
            ),
          );
        await tx
          .delete(trainingPathItems)
          .where(
            and(
              eq(trainingPathItems.pathId, pathId),
              eq(trainingPathItems.organizationId, actor.organizationId),
            ),
          );
        await tx.insert(trainingPathItems).values(
          input.items.map((item, index) => ({
            id: randomUUID(),
            organizationId: actor.organizationId,
            pathId,
            sopId: item.sopId,
            isRequired: item.isRequired,
            displayOrder: index + 1,
            versionPolicy: item.versionPolicy,
          })),
        );
      }),
    "A training path or qualification with that name already exists at this location.",
  );

  await auditPathMutation(actor, "training_path.updated", pathId, current.locationId, requestId);
  return getPathDetail(actor, pathId);
}

/* ------------------------------------------------------------------------------------------- */
/* Manager qualification overview and detail                                                     */
/* ------------------------------------------------------------------------------------------- */

export interface QualificationOverviewRow {
  definitionId: string;
  definitionName: string;
  locationId: string;
  locationName: string;
  pathId: string;
  pathTitle: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  classification: QualificationClassification;
  isExpiringSoon: boolean;
  qualificationId: string | null;
  awardedAt: Date | null;
  expiresAt: Date | null;
}

/**
 * One row per active definition x active employee at that definition's location, classified into
 * `qualified` / `training` / `missing` / `expired` (mutually exclusive) with `isExpiringSoon` as a
 * separate cross-cutting flag — a row can be both `qualified` and expiring soon. `query.tab`
 * narrows to a single bucket server-side (the `"expiring"` tab filters on the flag rather than the
 * classification), but every row still carries both fields so a caller can also render an
 * unfiltered table with an "expiring" badge.
 */
export async function listQualificationsOverview(
  actor: ManagerSessionContext,
  query: QualificationOverviewQuery,
): Promise<QualificationOverviewRow[]> {
  const managedIds = await getManagedLocationIds(actor);
  if (managedIds.length === 0) return [];
  if (query.locationId && !managedIds.includes(query.locationId)) return [];
  const locationScope = query.locationId ? [query.locationId] : managedIds;

  const definitionRows = await getDb()
    .select({
      definitionId: qualificationDefinitions.id,
      definitionName: qualificationDefinitions.name,
      locationId: qualificationDefinitions.locationId,
      locationName: locations.name,
      pathId: trainingPaths.id,
      pathTitle: trainingPaths.title,
    })
    .from(qualificationDefinitions)
    .innerJoin(
      trainingPaths,
      and(
        eq(trainingPaths.qualificationDefinitionId, qualificationDefinitions.id),
        eq(trainingPaths.organizationId, qualificationDefinitions.organizationId),
      ),
    )
    .innerJoin(
      locations,
      and(
        eq(locations.id, qualificationDefinitions.locationId),
        eq(locations.organizationId, qualificationDefinitions.organizationId),
      ),
    )
    .where(
      and(
        eq(qualificationDefinitions.organizationId, actor.organizationId),
        inArray(qualificationDefinitions.locationId, locationScope),
        eq(qualificationDefinitions.status, "active"),
        eq(trainingPaths.status, "active"),
      ),
    );
  if (definitionRows.length === 0) return [];

  const definitionIds = definitionRows.map((row) => row.definitionId);
  const pathIds = definitionRows.map((row) => row.pathId);
  const scopedLocationIds = [...new Set(definitionRows.map((row) => row.locationId))];

  const [employeeRows, qualificationRows, pathSopRows] = await Promise.all([
    getDb()
      .select({
        id: employees.id,
        primaryLocationId: employees.primaryLocationId,
        displayName: employees.displayName,
        employeeNumber: employees.employeeNumber,
      })
      .from(employees)
      .where(
        and(
          eq(employees.organizationId, actor.organizationId),
          inArray(employees.primaryLocationId, scopedLocationIds),
          eq(employees.status, "active"),
        ),
      ),
    getDb()
      .select()
      .from(employeeQualifications)
      .where(
        and(
          eq(employeeQualifications.organizationId, actor.organizationId),
          inArray(employeeQualifications.definitionId, definitionIds),
          eq(employeeQualifications.status, "active"),
        ),
      ),
    getDb()
      .select({ pathId: trainingPathItems.pathId, sopId: trainingPathItems.sopId })
      .from(trainingPathItems)
      .where(
        and(
          eq(trainingPathItems.organizationId, actor.organizationId),
          inArray(trainingPathItems.pathId, pathIds),
        ),
      ),
  ]);

  const sopIdsByPathId = new Map<string, string[]>();
  for (const row of pathSopRows) {
    const list = sopIdsByPathId.get(row.pathId) ?? [];
    list.push(row.sopId);
    sopIdsByPathId.set(row.pathId, list);
  }
  const allSopIds = [...new Set(pathSopRows.map((row) => row.sopId))];

  const nonTerminalRows =
    allSopIds.length === 0
      ? []
      : await getDb()
          .select({ employeeId: trainingAssignments.employeeId, sopId: sopVersions.sopId })
          .from(trainingAssignments)
          .innerJoin(
            sopVersions,
            and(
              eq(sopVersions.id, trainingAssignments.sopVersionId),
              eq(sopVersions.organizationId, trainingAssignments.organizationId),
            ),
          )
          .where(
            and(
              eq(trainingAssignments.organizationId, actor.organizationId),
              inArray(sopVersions.sopId, allSopIds),
              inArray(trainingAssignments.status, ["assigned", "in_progress"]),
            ),
          );
  const trainingPairs = new Set(nonTerminalRows.map((row) => `${row.employeeId}:${row.sopId}`));

  const activeQualByPair = new Map<string, (typeof qualificationRows)[number]>();
  for (const row of qualificationRows) {
    activeQualByPair.set(`${row.employeeId}:${row.definitionId}`, row);
  }
  const employeesByLocation = new Map<string, typeof employeeRows>();
  for (const employee of employeeRows) {
    const list = employeesByLocation.get(employee.primaryLocationId) ?? [];
    list.push(employee);
    employeesByLocation.set(employee.primaryLocationId, list);
  }

  const rows: QualificationOverviewRow[] = [];
  for (const definition of definitionRows) {
    const candidateEmployees = employeesByLocation.get(definition.locationId) ?? [];
    const sopIds = sopIdsByPathId.get(definition.pathId) ?? [];
    for (const employee of candidateEmployees) {
      const qualification = activeQualByPair.get(`${employee.id}:${definition.definitionId}`);
      const { classification, isExpiringSoon } = classifyQualification({
        hasActiveEpisode: Boolean(qualification),
        expiresAt: qualification?.expiresAt ?? null,
        hasNonTerminalTraining: sopIds.some((sopId) =>
          trainingPairs.has(`${employee.id}:${sopId}`),
        ),
      });
      if (query.tab) {
        if (query.tab === "expiring") {
          if (!isExpiringSoon) continue;
        } else if (classification !== query.tab) {
          continue;
        }
      }
      rows.push({
        definitionId: definition.definitionId,
        definitionName: definition.definitionName,
        locationId: definition.locationId,
        locationName: definition.locationName,
        pathId: definition.pathId,
        pathTitle: definition.pathTitle,
        employeeId: employee.id,
        employeeName: employee.displayName,
        employeeNumber: employee.employeeNumber,
        classification,
        isExpiringSoon,
        qualificationId: qualification?.id ?? null,
        awardedAt: qualification?.awardedAt ?? null,
        expiresAt: qualification?.expiresAt ?? null,
      });
    }
  }
  return rows;
}

async function loadSupportingSessionsDetail(organizationId: string, qualificationId: string) {
  return getDb()
    .select({
      sessionId: qualificationSupportingSessions.sessionId,
      completedAt: trainingSessions.completedAt,
      sopId: sopVersions.sopId,
      sopTitle: sopVersions.title,
      sopVersionNumber: sopVersions.versionNumber,
    })
    .from(qualificationSupportingSessions)
    .innerJoin(
      trainingSessions,
      and(
        eq(trainingSessions.id, qualificationSupportingSessions.sessionId),
        eq(trainingSessions.organizationId, qualificationSupportingSessions.organizationId),
      ),
    )
    .innerJoin(
      trainingAssignments,
      and(
        eq(trainingAssignments.id, trainingSessions.assignmentId),
        eq(trainingAssignments.organizationId, trainingSessions.organizationId),
      ),
    )
    .innerJoin(
      sopVersions,
      and(
        eq(sopVersions.id, trainingAssignments.sopVersionId),
        eq(sopVersions.organizationId, trainingAssignments.organizationId),
      ),
    )
    .where(
      and(
        eq(qualificationSupportingSessions.organizationId, organizationId),
        eq(qualificationSupportingSessions.qualificationId, qualificationId),
      ),
    )
    .orderBy(asc(sopVersions.title));
}

export async function getQualificationDetail(
  actor: ManagerSessionContext,
  qualificationId: string,
) {
  const [row] = await getDb()
    .select({
      qualification: employeeQualifications,
      definition: qualificationDefinitions,
      path: trainingPaths,
      employeeName: employees.displayName,
      employeeNumber: employees.employeeNumber,
      locationName: locations.name,
    })
    .from(employeeQualifications)
    .innerJoin(
      qualificationDefinitions,
      and(
        eq(qualificationDefinitions.id, employeeQualifications.definitionId),
        eq(qualificationDefinitions.organizationId, employeeQualifications.organizationId),
      ),
    )
    .innerJoin(
      trainingPaths,
      and(
        eq(trainingPaths.id, employeeQualifications.sourcePathId),
        eq(trainingPaths.organizationId, employeeQualifications.organizationId),
      ),
    )
    .innerJoin(
      employees,
      and(
        eq(employees.id, employeeQualifications.employeeId),
        eq(employees.organizationId, employeeQualifications.organizationId),
      ),
    )
    .innerJoin(
      locations,
      and(
        eq(locations.id, qualificationDefinitions.locationId),
        eq(locations.organizationId, qualificationDefinitions.organizationId),
      ),
    )
    .where(
      and(
        eq(employeeQualifications.id, qualificationId),
        eq(employeeQualifications.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Qualification not found.");
  await requireManagerManagedLocation(actor, row.definition.locationId);

  const supportingSessions = await loadSupportingSessionsDetail(
    actor.organizationId,
    qualificationId,
  );
  const now = Date.now();
  const isExpired =
    row.qualification.expiresAt !== null && row.qualification.expiresAt.getTime() <= now;

  return {
    id: row.qualification.id,
    status: row.qualification.status,
    awardedAt: row.qualification.awardedAt,
    expiresAt: row.qualification.expiresAt,
    isExpired,
    revokedAt: row.qualification.revokedAt,
    revokedNote: row.qualification.revokedNote,
    revokedByManagerUserId: row.qualification.revokedByManagerUserId,
    canRevoke: row.qualification.status === "active",
    definition: {
      id: row.definition.id,
      name: row.definition.name,
      description: row.definition.description,
      defaultValidityDays: row.definition.defaultValidityDays,
    },
    path: { id: row.path.id, title: row.path.title },
    employeeId: row.qualification.employeeId,
    employeeName: row.employeeName,
    employeeNumber: row.employeeNumber,
    locationId: row.definition.locationId,
    locationName: row.locationName,
    supportingSessions,
  };
}

/* ------------------------------------------------------------------------------------------- */
/* Employee-facing reads                                                                         */
/* ------------------------------------------------------------------------------------------- */

export interface EmployeeQualificationSummary {
  definitionId: string;
  definitionName: string;
  pathId: string;
  pathTitle: string;
  qualificationId: string | null;
  status: QualificationClassification;
  isExpiringSoon: boolean;
  awardedAt: Date | null;
  expiresAt: Date | null;
}

export interface EmployeeQualificationSections {
  earned: EmployeeQualificationSummary[];
  expiring: EmployeeQualificationSummary[];
  expired: EmployeeQualificationSummary[];
  inProgress: EmployeeQualificationSummary[];
  missing: EmployeeQualificationSummary[];
}

/**
 * The signed-in employee's own qualifications at their authenticated location, grouped for the
 * Phase 11 `/employee/qualifications` list: earned (qualified and not expiring soon), expiring
 * soon (qualified within the 30-day window), expired (an active-status episode past its expiry),
 * in-progress (no qualifying episode but at least one non-terminal assignment toward the path),
 * and missing (neither). Reuses `classifyQualification`, the same derivation the manager overview
 * uses, so the rules are expressed once.
 */
export async function listQualificationsForEmployee(
  session: EmployeeSessionContext,
): Promise<EmployeeQualificationSections> {
  const sections: EmployeeQualificationSections = {
    earned: [],
    expiring: [],
    expired: [],
    inProgress: [],
    missing: [],
  };

  const definitionRows = await getDb()
    .select({
      definitionId: qualificationDefinitions.id,
      definitionName: qualificationDefinitions.name,
      pathId: trainingPaths.id,
      pathTitle: trainingPaths.title,
    })
    .from(qualificationDefinitions)
    .innerJoin(
      trainingPaths,
      and(
        eq(trainingPaths.qualificationDefinitionId, qualificationDefinitions.id),
        eq(trainingPaths.organizationId, qualificationDefinitions.organizationId),
      ),
    )
    .where(
      and(
        eq(qualificationDefinitions.organizationId, session.organizationId),
        eq(qualificationDefinitions.locationId, session.locationId),
        eq(qualificationDefinitions.status, "active"),
        eq(trainingPaths.status, "active"),
      ),
    );
  if (definitionRows.length === 0) return sections;

  const definitionIds = definitionRows.map((row) => row.definitionId);
  const pathIds = definitionRows.map((row) => row.pathId);

  const [qualificationRows, pathSopRows] = await Promise.all([
    getDb()
      .select()
      .from(employeeQualifications)
      .where(
        and(
          eq(employeeQualifications.organizationId, session.organizationId),
          eq(employeeQualifications.employeeId, session.employeeId),
          inArray(employeeQualifications.definitionId, definitionIds),
          eq(employeeQualifications.status, "active"),
        ),
      ),
    getDb()
      .select({ pathId: trainingPathItems.pathId, sopId: trainingPathItems.sopId })
      .from(trainingPathItems)
      .where(
        and(
          eq(trainingPathItems.organizationId, session.organizationId),
          inArray(trainingPathItems.pathId, pathIds),
        ),
      ),
  ]);

  const sopIdsByPathId = new Map<string, string[]>();
  for (const row of pathSopRows) {
    const list = sopIdsByPathId.get(row.pathId) ?? [];
    list.push(row.sopId);
    sopIdsByPathId.set(row.pathId, list);
  }
  const allSopIds = [...new Set(pathSopRows.map((row) => row.sopId))];

  const nonTerminalRows =
    allSopIds.length === 0
      ? []
      : await getDb()
          .select({ sopId: sopVersions.sopId })
          .from(trainingAssignments)
          .innerJoin(
            sopVersions,
            and(
              eq(sopVersions.id, trainingAssignments.sopVersionId),
              eq(sopVersions.organizationId, trainingAssignments.organizationId),
            ),
          )
          .where(
            and(
              eq(trainingAssignments.organizationId, session.organizationId),
              eq(trainingAssignments.employeeId, session.employeeId),
              inArray(sopVersions.sopId, allSopIds),
              inArray(trainingAssignments.status, ["assigned", "in_progress"]),
            ),
          );
  const inTrainingSopIds = new Set(nonTerminalRows.map((row) => row.sopId));
  const qualByDefinitionId = new Map(qualificationRows.map((row) => [row.definitionId, row]));

  for (const definition of definitionRows) {
    const qualification = qualByDefinitionId.get(definition.definitionId);
    const sopIds = sopIdsByPathId.get(definition.pathId) ?? [];
    const { classification, isExpiringSoon } = classifyQualification({
      hasActiveEpisode: Boolean(qualification),
      expiresAt: qualification?.expiresAt ?? null,
      hasNonTerminalTraining: sopIds.some((sopId) => inTrainingSopIds.has(sopId)),
    });
    const summary: EmployeeQualificationSummary = {
      definitionId: definition.definitionId,
      definitionName: definition.definitionName,
      pathId: definition.pathId,
      pathTitle: definition.pathTitle,
      qualificationId: qualification?.id ?? null,
      status: classification,
      isExpiringSoon,
      awardedAt: qualification?.awardedAt ?? null,
      expiresAt: qualification?.expiresAt ?? null,
    };
    if (classification === "expired") sections.expired.push(summary);
    else if (classification === "qualified" && isExpiringSoon) sections.expiring.push(summary);
    else if (classification === "qualified") sections.earned.push(summary);
    else if (classification === "training") sections.inProgress.push(summary);
    else sections.missing.push(summary);
  }
  return sections;
}

/** A single qualification's detail for its owning employee. Rejects if it belongs to another employee. */
export async function getQualificationDetailForEmployee(
  session: EmployeeSessionContext,
  qualificationId: string,
) {
  const [row] = await getDb()
    .select({
      qualification: employeeQualifications,
      definition: qualificationDefinitions,
      path: trainingPaths,
    })
    .from(employeeQualifications)
    .innerJoin(
      qualificationDefinitions,
      and(
        eq(qualificationDefinitions.id, employeeQualifications.definitionId),
        eq(qualificationDefinitions.organizationId, employeeQualifications.organizationId),
      ),
    )
    .innerJoin(
      trainingPaths,
      and(
        eq(trainingPaths.id, employeeQualifications.sourcePathId),
        eq(trainingPaths.organizationId, employeeQualifications.organizationId),
      ),
    )
    .where(
      and(
        eq(employeeQualifications.id, qualificationId),
        eq(employeeQualifications.organizationId, session.organizationId),
      ),
    )
    .limit(1);
  if (!row || row.qualification.employeeId !== session.employeeId) {
    throw new AppError("NOT_FOUND", "Qualification not found.");
  }

  const supportingSessions = await loadSupportingSessionsDetail(
    session.organizationId,
    qualificationId,
  );
  const now = Date.now();
  const isExpired =
    row.qualification.expiresAt !== null && row.qualification.expiresAt.getTime() <= now;

  return {
    id: row.qualification.id,
    status: row.qualification.status,
    awardedAt: row.qualification.awardedAt,
    expiresAt: row.qualification.expiresAt,
    isExpired,
    revokedAt: row.qualification.revokedAt,
    revokedNote: row.qualification.revokedNote,
    definition: {
      id: row.definition.id,
      name: row.definition.name,
      description: row.definition.description,
    },
    path: { id: row.path.id, title: row.path.title },
    supportingSessions,
  };
}
