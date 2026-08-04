import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { ManagerSessionContext } from "@/server/auth/sessions";
import { getDb } from "@/server/db/client";
import {
  approvalDecisions,
  approvalSubmissions,
  checklistApprovalDecisions,
  checklistApprovalSubmissions,
  checklistRuns,
  checklists,
  employees,
  locations,
  managerUsers,
  sopVersions,
  trainingAssignments,
  trainingSessions,
} from "@/server/db/schema";
import { getManagedLocationIds } from "@/server/management/service";
import type { ApprovalHistoryReportQuery } from "@/server/reports-schemas";

export interface ApprovalHistoryRow {
  id: string;
  kind: "training" | "checklist";
  decision: "approved" | "rejected" | "needs_correction";
  note: string;
  decidedAt: Date;
  decidedByName: string;
  employeeName: string;
  subjectTitle: string;
  locationId: string;
  locationName: string;
}

/**
 * Approval decision history across both dedicated approval-decision tables (`data-model.md`
 * deliberately keeps training and checklist decisions in separate tables rather than one shared
 * subject reference, so this merges them in application code rather than a typed SQL union).
 * Each branch is fetched sorted and capped generously above the requested page, merge-sorted by
 * `decidedAt`, then sliced — correct for any page within the cap, and this app's decision volume
 * per organization stays far under it in practice.
 */
export async function getApprovalHistoryReport(
  actor: ManagerSessionContext,
  query: ApprovalHistoryReportQuery,
): Promise<{ items: ApprovalHistoryRow[]; total: number; page: number; pageSize: number }> {
  const empty = { items: [], total: 0, page: query.page, pageSize: query.pageSize };
  const managedIds = await getManagedLocationIds(actor);
  if (managedIds.length === 0) return empty;
  if (query.locationId && !managedIds.includes(query.locationId)) return empty;
  const locationScope = query.locationId ? [query.locationId] : managedIds;

  const fetchCap = Math.min(Math.max(query.page * query.pageSize, query.pageSize), 1_000);

  const trainingConditions = [
    eq(approvalDecisions.organizationId, actor.organizationId),
    inArray(trainingAssignments.locationId, locationScope),
  ];
  if (query.decision) trainingConditions.push(eq(approvalDecisions.decision, query.decision));

  const checklistConditions = [
    eq(checklistApprovalDecisions.organizationId, actor.organizationId),
    inArray(checklistRuns.locationId, locationScope),
  ];
  if (query.decision) {
    checklistConditions.push(eq(checklistApprovalDecisions.decision, query.decision));
  }

  const db = getDb();
  const [trainingRows, checklistRows, trainingTotal, checklistTotal] = await Promise.all([
    db
      .select({
        id: approvalDecisions.id,
        decision: approvalDecisions.decision,
        note: approvalDecisions.note,
        decidedAt: approvalDecisions.decidedAt,
        decidedByName: managerUsers.displayName,
        employeeName: employees.displayName,
        subjectTitle: sopVersions.title,
        locationId: trainingAssignments.locationId,
        locationName: locations.name,
      })
      .from(approvalDecisions)
      .innerJoin(
        approvalSubmissions,
        and(
          eq(approvalSubmissions.id, approvalDecisions.submissionId),
          eq(approvalSubmissions.organizationId, approvalDecisions.organizationId),
        ),
      )
      .innerJoin(
        trainingSessions,
        and(
          eq(trainingSessions.id, approvalSubmissions.sessionId),
          eq(trainingSessions.organizationId, approvalSubmissions.organizationId),
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
        employees,
        and(
          eq(employees.id, trainingAssignments.employeeId),
          eq(employees.organizationId, trainingAssignments.organizationId),
        ),
      )
      .innerJoin(
        sopVersions,
        and(
          eq(sopVersions.id, trainingAssignments.sopVersionId),
          eq(sopVersions.organizationId, trainingAssignments.organizationId),
        ),
      )
      .innerJoin(
        locations,
        and(
          eq(locations.id, trainingAssignments.locationId),
          eq(locations.organizationId, trainingAssignments.organizationId),
        ),
      )
      .innerJoin(managerUsers, eq(managerUsers.id, approvalDecisions.decidedByManagerUserId))
      .where(and(...trainingConditions))
      .orderBy(desc(approvalDecisions.decidedAt))
      .limit(fetchCap),
    db
      .select({
        id: checklistApprovalDecisions.id,
        decision: checklistApprovalDecisions.decision,
        note: checklistApprovalDecisions.note,
        decidedAt: checklistApprovalDecisions.decidedAt,
        decidedByName: managerUsers.displayName,
        employeeName: employees.displayName,
        subjectTitle: checklists.title,
        locationId: checklistRuns.locationId,
        locationName: locations.name,
      })
      .from(checklistApprovalDecisions)
      .innerJoin(
        checklistApprovalSubmissions,
        and(
          eq(checklistApprovalSubmissions.id, checklistApprovalDecisions.submissionId),
          eq(
            checklistApprovalSubmissions.organizationId,
            checklistApprovalDecisions.organizationId,
          ),
        ),
      )
      .innerJoin(
        checklistRuns,
        and(
          eq(checklistRuns.id, checklistApprovalSubmissions.runId),
          eq(checklistRuns.organizationId, checklistApprovalSubmissions.organizationId),
        ),
      )
      .innerJoin(
        checklists,
        and(
          eq(checklists.id, checklistRuns.checklistId),
          eq(checklists.organizationId, checklistRuns.organizationId),
        ),
      )
      .innerJoin(
        employees,
        and(
          eq(employees.id, checklistRuns.employeeId),
          eq(employees.organizationId, checklistRuns.organizationId),
        ),
      )
      .innerJoin(
        locations,
        and(
          eq(locations.id, checklistRuns.locationId),
          eq(locations.organizationId, checklistRuns.organizationId),
        ),
      )
      .innerJoin(
        managerUsers,
        eq(managerUsers.id, checklistApprovalDecisions.decidedByManagerUserId),
      )
      .where(and(...checklistConditions))
      .orderBy(desc(checklistApprovalDecisions.decidedAt))
      .limit(fetchCap),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(approvalDecisions)
      .innerJoin(
        approvalSubmissions,
        and(
          eq(approvalSubmissions.id, approvalDecisions.submissionId),
          eq(approvalSubmissions.organizationId, approvalDecisions.organizationId),
        ),
      )
      .innerJoin(
        trainingSessions,
        and(
          eq(trainingSessions.id, approvalSubmissions.sessionId),
          eq(trainingSessions.organizationId, approvalSubmissions.organizationId),
        ),
      )
      .innerJoin(
        trainingAssignments,
        and(
          eq(trainingAssignments.id, trainingSessions.assignmentId),
          eq(trainingAssignments.organizationId, trainingSessions.organizationId),
        ),
      )
      .where(and(...trainingConditions)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(checklistApprovalDecisions)
      .innerJoin(
        checklistApprovalSubmissions,
        and(
          eq(checklistApprovalSubmissions.id, checklistApprovalDecisions.submissionId),
          eq(
            checklistApprovalSubmissions.organizationId,
            checklistApprovalDecisions.organizationId,
          ),
        ),
      )
      .innerJoin(
        checklistRuns,
        and(
          eq(checklistRuns.id, checklistApprovalSubmissions.runId),
          eq(checklistRuns.organizationId, checklistApprovalSubmissions.organizationId),
        ),
      )
      .where(and(...checklistConditions)),
  ]);

  const merged: ApprovalHistoryRow[] = [
    ...trainingRows.map((row) => ({ ...row, kind: "training" as const })),
    ...checklistRows.map((row) => ({ ...row, kind: "checklist" as const })),
  ].sort((a, b) => b.decidedAt.getTime() - a.decidedAt.getTime());

  const start = (query.page - 1) * query.pageSize;
  return {
    items: merged.slice(start, start + query.pageSize),
    total: (trainingTotal[0]?.count ?? 0) + (checklistTotal[0]?.count ?? 0),
    page: query.page,
    pageSize: query.pageSize,
  };
}
