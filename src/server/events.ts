import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import type { ManagerSessionContext } from "@/server/auth/sessions";
import { getDb } from "@/server/db/client";
import {
  checklistRuns,
  checklists,
  domainEvents,
  employeeQualifications,
  employees,
  locations,
  qualificationDefinitions,
  sopVersions,
  sops,
  trainingAssignments,
} from "@/server/db/schema";
import { getManagedLocationIds } from "@/server/management/service";

/**
 * A curated subset of business-lifecycle facts, deliberately smaller than `AuditAction`: only
 * milestones a manager would want on `/manager/activity` or a Phase 16 notification, never
 * step-by-step progress noise that `audit_events` already covers.
 */
export type DomainEventType =
  | "sop.published"
  | "sop.archived"
  | "training.assignment_batch_created"
  | "training.session_completed"
  | "training.approval_decided"
  | "qualification.awarded"
  | "qualification.revoked"
  | "checklist.created"
  | "checklist_run.submitted"
  | "checklist_run.approval_decided"
  | "translation.approved";

export const domainEventTypeValues: readonly DomainEventType[] = [
  "sop.published",
  "sop.archived",
  "training.assignment_batch_created",
  "training.session_completed",
  "training.approval_decided",
  "qualification.awarded",
  "qualification.revoked",
  "checklist.created",
  "checklist_run.submitted",
  "checklist_run.approval_decided",
  "translation.approved",
];

/** Subject types a domain event can point at; used to batch-resolve display labels for the feed. */
export type DomainEventSubjectType =
  "sop" | "training_assignment" | "employee_qualification" | "checklist" | "checklist_run";

export interface DomainEventInput {
  organizationId: string;
  locationId: string;
  type: DomainEventType;
  subjectType: DomainEventSubjectType;
  subjectId: string;
  payload?: Record<string, string | number | boolean | null>;
}

/** The row `writeDomainEvent` inserts, returned so callers can dispatch Phase 16 notifications
 * off the exact event just written without a second read. */
export interface DomainEventRecord {
  id: string;
  organizationId: string;
  locationId: string | null;
  type: DomainEventType;
  subjectType: DomainEventSubjectType;
  subjectId: string;
  payload: Record<string, string | number | boolean | null>;
  occurredAt: Date;
}

export async function writeDomainEvent(input: DomainEventInput): Promise<DomainEventRecord> {
  const payload = Object.fromEntries(
    Object.entries(input.payload ?? {}).filter(
      ([key]) => !/(password|pin|token|secret|authorization|cookie)/i.test(key),
    ),
  );
  const [row] = await getDb()
    .insert(domainEvents)
    .values({
      id: randomUUID(),
      organizationId: input.organizationId,
      locationId: input.locationId,
      type: input.type,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      payload,
    })
    .returning();
  if (!row) throw new AppError("INTERNAL_ERROR", "Domain event could not be recorded.");
  return {
    id: row.id,
    organizationId: row.organizationId,
    locationId: row.locationId,
    type: row.type as DomainEventType,
    subjectType: row.subjectType as DomainEventSubjectType,
    subjectId: row.subjectId,
    payload: row.payload,
    occurredAt: row.occurredAt,
  };
}

export interface ActivityQuery {
  locationId?: string;
  type?: DomainEventType | "";
  page: number;
  pageSize: number;
}

export interface ActivityRow {
  id: string;
  type: DomainEventType;
  subjectType: DomainEventSubjectType;
  subjectId: string;
  payload: Record<string, string | number | boolean | null>;
  locationId: string;
  locationName: string;
  occurredAt: Date;
  label: string;
}

/**
 * Batch-resolves a human label per subject rather than joining at write time: mutation call sites
 * stay cheap (no extra lookups), and the feed — a few dozen rows per page — pays a handful of
 * grouped queries instead of one join per subject type baked into the write path.
 */
async function resolveLabels(
  organizationId: string,
  rows: readonly { subjectType: string; subjectId: string }[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const idsByType = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = idsByType.get(row.subjectType) ?? new Set<string>();
    set.add(row.subjectId);
    idsByType.set(row.subjectType, set);
  }

  const sopIds = [...(idsByType.get("sop") ?? [])];
  const assignmentIds = [...(idsByType.get("training_assignment") ?? [])];
  const checklistIds = [...(idsByType.get("checklist") ?? [])];
  const checklistRunIds = [...(idsByType.get("checklist_run") ?? [])];
  const qualificationIds = [...(idsByType.get("employee_qualification") ?? [])];

  const db = getDb();
  const [sopRows, assignmentRows, checklistRows, checklistRunRows, qualificationRows] =
    await Promise.all([
      sopIds.length === 0
        ? []
        : db
            .select({ id: sops.id, title: sopVersions.title })
            .from(sops)
            .innerJoin(
              sopVersions,
              and(
                eq(sopVersions.id, sops.currentVersionId),
                eq(sopVersions.organizationId, sops.organizationId),
              ),
            )
            .where(and(eq(sops.organizationId, organizationId), inArray(sops.id, sopIds))),
      assignmentIds.length === 0
        ? []
        : db
            .select({
              id: trainingAssignments.id,
              employeeName: employees.displayName,
              sopTitle: sopVersions.title,
            })
            .from(trainingAssignments)
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
            .where(
              and(
                eq(trainingAssignments.organizationId, organizationId),
                inArray(trainingAssignments.id, assignmentIds),
              ),
            ),
      checklistIds.length === 0
        ? []
        : db
            .select({ id: checklists.id, title: checklists.title })
            .from(checklists)
            .where(
              and(
                eq(checklists.organizationId, organizationId),
                inArray(checklists.id, checklistIds),
              ),
            ),
      checklistRunIds.length === 0
        ? []
        : db
            .select({
              id: checklistRuns.id,
              checklistTitle: checklists.title,
              employeeName: employees.displayName,
            })
            .from(checklistRuns)
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
            .where(
              and(
                eq(checklistRuns.organizationId, organizationId),
                inArray(checklistRuns.id, checklistRunIds),
              ),
            ),
      qualificationIds.length === 0
        ? []
        : db
            .select({
              id: employeeQualifications.id,
              definitionName: qualificationDefinitions.name,
              employeeName: employees.displayName,
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
              employees,
              and(
                eq(employees.id, employeeQualifications.employeeId),
                eq(employees.organizationId, employeeQualifications.organizationId),
              ),
            )
            .where(
              and(
                eq(employeeQualifications.organizationId, organizationId),
                inArray(employeeQualifications.id, qualificationIds),
              ),
            ),
    ]);

  for (const row of sopRows) labels.set(`sop:${row.id}`, row.title);
  for (const row of assignmentRows) {
    labels.set(`training_assignment:${row.id}`, `${row.employeeName} — ${row.sopTitle}`);
  }
  for (const row of checklistRows) labels.set(`checklist:${row.id}`, row.title);
  for (const row of checklistRunRows) {
    labels.set(`checklist_run:${row.id}`, `${row.employeeName} — ${row.checklistTitle}`);
  }
  for (const row of qualificationRows) {
    labels.set(`employee_qualification:${row.id}`, `${row.employeeName} — ${row.definitionName}`);
  }
  return labels;
}

/**
 * Paginated, tenant/location-scoped activity feed built from `domain_events`. Owners see every
 * managed location's events; scoped managers see only their permitted locations, exactly like
 * every other manager list in the app.
 */
export async function listActivity(
  actor: ManagerSessionContext,
  query: ActivityQuery,
): Promise<{ items: ActivityRow[]; total: number; page: number; pageSize: number }> {
  const empty = { items: [], total: 0, page: query.page, pageSize: query.pageSize };
  const managedIds = await getManagedLocationIds(actor);
  if (managedIds.length === 0) return empty;
  if (query.locationId && !managedIds.includes(query.locationId)) return empty;

  const conditions: SQL[] = [
    eq(domainEvents.organizationId, actor.organizationId),
    inArray(domainEvents.locationId, query.locationId ? [query.locationId] : managedIds),
  ];
  if (query.type) conditions.push(eq(domainEvents.type, query.type));

  const db = getDb();
  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: domainEvents.id,
        type: domainEvents.type,
        subjectType: domainEvents.subjectType,
        subjectId: domainEvents.subjectId,
        payload: domainEvents.payload,
        locationId: domainEvents.locationId,
        locationName: locations.name,
        occurredAt: domainEvents.occurredAt,
      })
      .from(domainEvents)
      .innerJoin(
        locations,
        and(
          eq(locations.id, domainEvents.locationId),
          eq(locations.organizationId, domainEvents.organizationId),
        ),
      )
      .where(and(...conditions))
      .orderBy(desc(domainEvents.occurredAt), desc(domainEvents.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(domainEvents)
      .where(and(...conditions)),
  ]);

  const labels = await resolveLabels(actor.organizationId, rows);
  const items: ActivityRow[] = rows.map((row) => ({
    id: row.id,
    type: row.type as DomainEventType,
    subjectType: row.subjectType as DomainEventSubjectType,
    subjectId: row.subjectId,
    payload: row.payload,
    locationId: row.locationId ?? "",
    locationName: row.locationName,
    occurredAt: row.occurredAt,
    label: labels.get(`${row.subjectType}:${row.subjectId}`) ?? row.subjectType,
  }));

  return { items, total: totalRows[0]?.count ?? 0, page: query.page, pageSize: query.pageSize };
}
