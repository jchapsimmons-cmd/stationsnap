import { and, eq, inArray, sql } from "drizzle-orm";
import type { ManagerSessionContext } from "@/server/auth/sessions";
import { getDb } from "@/server/db/client";
import {
  managerMemberships,
  managerUsers,
  trainingPathItems,
  trainingSessions,
} from "@/server/db/schema";

/**
 * Resolves a manager user's display name for the caller's own organization only. Used by the
 * qualification detail page to show who recorded a revocation, mirroring how the approvals detail
 * page joins `managerUsers` for `decidedByName` — `revokeQualification` only stores the acting
 * manager's id, not their name, so this is read separately by the page rather than by the service.
 */
export async function getManagerDisplayName(
  actor: ManagerSessionContext,
  managerUserId: string,
): Promise<string | null> {
  const [row] = await getDb()
    .select({ displayName: managerUsers.displayName })
    .from(managerUsers)
    .innerJoin(
      managerMemberships,
      and(
        eq(managerMemberships.managerUserId, managerUsers.id),
        eq(managerMemberships.organizationId, actor.organizationId),
      ),
    )
    .where(eq(managerUsers.id, managerUserId))
    .limit(1);
  return row?.displayName ?? null;
}

/**
 * Maps each given training session id to the assignment it belongs to, scoped to the caller's
 * organization. Used so the qualification detail page can link a supporting session back to its
 * assignment — `getQualificationDetail`'s supporting-session rows carry the session id but not the
 * assignment id.
 */
export async function resolveAssignmentIdsForSessions(
  organizationId: string,
  sessionIds: readonly string[],
): Promise<Map<string, string>> {
  if (sessionIds.length === 0) return new Map();
  const rows = await getDb()
    .select({ id: trainingSessions.id, assignmentId: trainingSessions.assignmentId })
    .from(trainingSessions)
    .where(
      and(
        eq(trainingSessions.organizationId, organizationId),
        inArray(trainingSessions.id, [...sessionIds]),
      ),
    );
  return new Map(rows.map((row) => [row.id, row.assignmentId]));
}

/**
 * Counts each path's items in one query, for display on the training path list. `listPaths`
 * intentionally omits this (it is a plain list read), so the page composes it separately.
 */
export async function countPathItems(
  organizationId: string,
  pathIds: readonly string[],
): Promise<Map<string, number>> {
  if (pathIds.length === 0) return new Map();
  const rows = await getDb()
    .select({ pathId: trainingPathItems.pathId, count: sql<number>`count(*)::int` })
    .from(trainingPathItems)
    .where(
      and(
        eq(trainingPathItems.organizationId, organizationId),
        inArray(trainingPathItems.pathId, [...pathIds]),
      ),
    )
    .groupBy(trainingPathItems.pathId);
  return new Map(rows.map((row) => [row.pathId, row.count]));
}
