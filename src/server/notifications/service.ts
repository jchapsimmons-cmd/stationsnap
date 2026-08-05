import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, lte, sql, type SQL } from "drizzle-orm";
import { calendarDateInTimeZone } from "@/lib/timezone";
import { AppError } from "@/lib/errors";
import { isEmailDeliveryConfigured, sendNotificationEmail } from "@/server/email";
import type { DomainEventRecord } from "@/server/events";
import { getDb } from "@/server/db/client";
import {
  checklistRuns,
  checklists,
  domainEvents,
  employeeQualifications,
  employees,
  notificationDeliveries,
  notifications,
  organizations,
  qualificationDefinitions,
  scheduledJobRuns,
  sopVersions,
  trainingAssignments,
} from "@/server/db/schema";
import { getLocationRecipientManagers } from "@/server/management/service";
import { EXPIRING_SOON_WINDOW_MS } from "@/server/training/qualification-windows";
import type { EmployeeSessionContext, ManagerSessionContext } from "@/server/auth/sessions";
import { resolveNotificationText, type NotificationType } from "@/server/notifications/labels";
import type { NotificationQuery } from "@/server/notifications/schemas";

export type { NotificationType } from "@/server/notifications/labels";

// A training assignment enters this window before its due date without yet being late — a fixed
// simplification for this phase, the same style as qualifications.ts's own
// `EXPIRING_SOON_WINDOW_MS`: not a value a manager can configure per SOP or organization.
const DUE_SOON_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

const TIME_RECONCILE_JOB_TYPE = "notification_time_reconcile";

function postgresCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? postgresCode(error.cause) : undefined;
}

/** Strips the same secret-shaped keys `writeDomainEvent` already filters from `domain_events`
 * payloads, so a notification's `params` never carries anything that shouldn't be emailed. */
function sanitizeParams(
  params: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([key]) => !/(password|pin|token|secret|authorization|cookie)/i.test(key),
    ),
  );
}

interface CreateNotificationInput {
  organizationId: string;
  locationId: string | null;
  recipientType: "manager" | "employee";
  recipientId: string;
  type: NotificationType;
  subjectType?: string;
  subjectId?: string | null;
  params: Record<string, string | number | boolean | null>;
  internalPath: string;
  dedupeKey: string;
  email?: { to: string } | null;
}

/**
 * Inserts one notification plus its in-app delivery record, then — for a manager recipient with
 * an email address and SMTP configured — attempts an email delivery too. Idempotent on
 * `dedupeKey`: a conflict means this exact occurrence was already notified, so this silently
 * returns rather than throwing, letting every call site (event dispatch, the time-based reconcile
 * pass, and their respective catch-up retries) call this any number of times safely.
 */
async function createNotification(input: CreateNotificationInput): Promise<void> {
  const params = sanitizeParams(input.params);
  const id = randomUUID();
  let inserted: typeof notifications.$inferSelect | undefined;
  try {
    [inserted] = await getDb()
      .insert(notifications)
      .values({
        id,
        organizationId: input.organizationId,
        locationId: input.locationId,
        recipientType: input.recipientType,
        recipientId: input.recipientId,
        type: input.type,
        subjectType: input.subjectType ?? "",
        subjectId: input.subjectId ?? null,
        params,
        internalPath: input.internalPath,
        dedupeKey: input.dedupeKey,
      })
      .returning();
  } catch (error: unknown) {
    if (postgresCode(error) === "23505") return;
    throw error;
  }
  if (!inserted) return;

  await getDb().insert(notificationDeliveries).values({
    id: randomUUID(),
    organizationId: input.organizationId,
    notificationId: inserted.id,
    channel: "in_app",
    status: "sent",
  });

  if (!input.email) return;

  const { title, body } = resolveNotificationText(input.type, params);
  let status: "sent" | "failed" | "skipped" = "skipped";
  let errorCode = "smtp_not_configured";
  if (isEmailDeliveryConfigured()) {
    try {
      await sendNotificationEmail({ to: input.email.to, subject: title, text: body });
      status = "sent";
      errorCode = "";
    } catch {
      status = "failed";
      errorCode = "send_failed";
    }
  }
  await getDb().insert(notificationDeliveries).values({
    id: randomUUID(),
    organizationId: input.organizationId,
    notificationId: inserted.id,
    channel: "email",
    recipientAddress: input.email.to,
    status,
    errorCode,
  });
}

/**
 * Notifies a newly created training assignment's employee directly, bypassing the domain-event
 * dispatcher below: `training.assignment_batch_created` points at the SOP (its subject is the
 * whole batch), not at any one employee, so there is no single domain event to resolve a
 * per-employee recipient from. The assignment-creation call site in `assignTraining` already has
 * every field this needs, so it calls this directly instead. Idempotent on the assignment id,
 * which `assignTraining`'s own duplicate-active-assignment rule already guarantees is unique per
 * employee/version/generation.
 */
export async function notifyAssignmentCreated(input: {
  organizationId: string;
  locationId: string;
  employeeId: string;
  assignmentId: string;
  sopTitle: string;
}): Promise<void> {
  await createNotification({
    organizationId: input.organizationId,
    locationId: input.locationId,
    recipientType: "employee",
    recipientId: input.employeeId,
    type: "training.assigned",
    subjectType: "training_assignment",
    subjectId: input.assignmentId,
    params: { sopTitle: input.sopTitle },
    internalPath: `/employee/training/${input.assignmentId}`,
    dedupeKey: `assignment_created:${input.assignmentId}`,
  });
}

async function handleTrainingSessionCompleted(event: DomainEventRecord): Promise<void> {
  const status = event.payload["status"];
  const [row] = await getDb()
    .select({
      employeeId: trainingAssignments.employeeId,
      employeeName: employees.displayName,
      employeeStatus: employees.status,
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
        eq(trainingAssignments.id, event.subjectId),
        eq(trainingAssignments.organizationId, event.organizationId),
      ),
    )
    .limit(1);
  if (!row || !event.locationId) return;

  if (status === "awaiting_approval") {
    const managers = await getLocationRecipientManagers(event.organizationId, event.locationId);
    for (const manager of managers) {
      await createNotification({
        organizationId: event.organizationId,
        locationId: event.locationId,
        recipientType: "manager",
        recipientId: manager.membershipId,
        type: "training.awaiting_approval",
        subjectType: "training_assignment",
        subjectId: event.subjectId,
        params: { employeeName: row.employeeName, sopTitle: row.sopTitle },
        internalPath: "/manager/training/approvals",
        dedupeKey: `event:${event.id}:manager:${manager.membershipId}`,
        email: manager.email ? { to: manager.email } : null,
      });
    }
    return;
  }

  if (row.employeeStatus !== "active") return;
  if (status === "passed" || status === "failed") {
    await createNotification({
      organizationId: event.organizationId,
      locationId: event.locationId,
      recipientType: "employee",
      recipientId: row.employeeId,
      type: "training.completed",
      subjectType: "training_assignment",
      subjectId: event.subjectId,
      params: { sopTitle: row.sopTitle, status },
      internalPath: `/employee/training/${event.subjectId}/result`,
      dedupeKey: `event:${event.id}:employee:${row.employeeId}`,
    });
  }
}

async function handleTrainingApprovalDecided(event: DomainEventRecord): Promise<void> {
  const decision = event.payload["decision"];
  const submissionId = event.payload["submissionId"];
  const [row] = await getDb()
    .select({
      employeeId: trainingAssignments.employeeId,
      employeeStatus: employees.status,
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
        eq(trainingAssignments.id, event.subjectId),
        eq(trainingAssignments.organizationId, event.organizationId),
      ),
    )
    .limit(1);
  if (!row || row.employeeStatus !== "active" || !event.locationId) return;

  const internalPath =
    decision === "needs_correction" && typeof submissionId === "string"
      ? `/employee/approvals/${submissionId}`
      : `/employee/training/${event.subjectId}/result`;
  await createNotification({
    organizationId: event.organizationId,
    locationId: event.locationId,
    recipientType: "employee",
    recipientId: row.employeeId,
    type: "training.approval_decided",
    subjectType: "training_assignment",
    subjectId: event.subjectId,
    params: { sopTitle: row.sopTitle, decision: decision ?? "" },
    internalPath,
    dedupeKey: `event:${event.id}:employee:${row.employeeId}`,
  });
}

async function handleQualificationChanged(
  event: DomainEventRecord,
  type: "qualification.awarded" | "qualification.revoked",
): Promise<void> {
  const [row] = await getDb()
    .select({
      employeeId: employeeQualifications.employeeId,
      employeeStatus: employees.status,
      definitionName: qualificationDefinitions.name,
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
        eq(employeeQualifications.id, event.subjectId),
        eq(employeeQualifications.organizationId, event.organizationId),
      ),
    )
    .limit(1);
  if (!row || row.employeeStatus !== "active") return;

  await createNotification({
    organizationId: event.organizationId,
    locationId: event.locationId,
    recipientType: "employee",
    recipientId: row.employeeId,
    type,
    subjectType: "employee_qualification",
    subjectId: event.subjectId,
    params: { definitionName: row.definitionName },
    internalPath: `/employee/qualifications/${event.subjectId}`,
    dedupeKey: `event:${event.id}:employee:${row.employeeId}`,
  });
}

async function handleChecklistRunSubmitted(event: DomainEventRecord): Promise<void> {
  if (event.payload["status"] !== "awaiting_approval" || !event.locationId) return;
  const [row] = await getDb()
    .select({ employeeName: employees.displayName, checklistTitle: checklists.title })
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
        eq(checklistRuns.id, event.subjectId),
        eq(checklistRuns.organizationId, event.organizationId),
      ),
    )
    .limit(1);
  if (!row) return;

  const managers = await getLocationRecipientManagers(event.organizationId, event.locationId);
  for (const manager of managers) {
    await createNotification({
      organizationId: event.organizationId,
      locationId: event.locationId,
      recipientType: "manager",
      recipientId: manager.membershipId,
      type: "checklist_run.awaiting_approval",
      subjectType: "checklist_run",
      subjectId: event.subjectId,
      params: { employeeName: row.employeeName, checklistTitle: row.checklistTitle },
      internalPath: `/manager/checklist-runs/${event.subjectId}`,
      dedupeKey: `event:${event.id}:manager:${manager.membershipId}`,
      email: manager.email ? { to: manager.email } : null,
    });
  }
}

async function handleChecklistRunApprovalDecided(event: DomainEventRecord): Promise<void> {
  const decision = event.payload["decision"];
  const [row] = await getDb()
    .select({
      employeeId: checklistRuns.employeeId,
      employeeStatus: employees.status,
      checklistTitle: checklists.title,
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
        eq(checklistRuns.id, event.subjectId),
        eq(checklistRuns.organizationId, event.organizationId),
      ),
    )
    .limit(1);
  if (!row || row.employeeStatus !== "active" || !event.locationId) return;

  await createNotification({
    organizationId: event.organizationId,
    locationId: event.locationId,
    recipientType: "employee",
    recipientId: row.employeeId,
    type: "checklist_run.approval_decided",
    subjectType: "checklist_run",
    subjectId: event.subjectId,
    params: { checklistTitle: row.checklistTitle, decision: decision ?? "" },
    internalPath: `/employee/checklist-runs/${event.subjectId}`,
    dedupeKey: `event:${event.id}:employee:${row.employeeId}`,
  });
}

/**
 * Turns one `domain_events` row into zero or more notifications. `sop.published`, `sop.archived`,
 * `training.assignment_batch_created` (handled separately by `notifyAssignmentCreated` above),
 * `checklist.created`, and `translation.approved` are deliberately not notification-worthy on
 * their own — they stay purely on `/manager/activity` — so they fall through to the default case
 * and are simply marked processed.
 */
async function generateNotificationsForEvent(event: DomainEventRecord): Promise<void> {
  switch (event.type) {
    case "training.session_completed":
      await handleTrainingSessionCompleted(event);
      break;
    case "training.approval_decided":
      await handleTrainingApprovalDecided(event);
      break;
    case "qualification.awarded":
      await handleQualificationChanged(event, "qualification.awarded");
      break;
    case "qualification.revoked":
      await handleQualificationChanged(event, "qualification.revoked");
      break;
    case "checklist_run.submitted":
      await handleChecklistRunSubmitted(event);
      break;
    case "checklist_run.approval_decided":
      await handleChecklistRunApprovalDecided(event);
      break;
    default:
      break;
  }
}

async function markDomainEventProcessed(eventId: string, organizationId: string): Promise<void> {
  await getDb()
    .update(domainEvents)
    .set({ processingStatus: "processed" })
    .where(and(eq(domainEvents.id, eventId), eq(domainEvents.organizationId, organizationId)));
}

/**
 * Called right after every `writeDomainEvent` call site records its event (the same "best-effort,
 * not literally inside the mutation's own transaction" convention `domain_events` itself already
 * follows relative to the mutation that caused it). Failures here are swallowed and the event is
 * left `pending` rather than `processed`, so `reconcilePendingDomainEventNotifications` below can
 * pick it back up later — and because every notification insert is idempotent on `dedupeKey`,
 * reprocessing an event that partially succeeded never double-notifies anyone.
 */
export async function dispatchNotificationsForDomainEvent(event: DomainEventRecord): Promise<void> {
  try {
    await generateNotificationsForEvent(event);
    await markDomainEventProcessed(event.id, event.organizationId);
  } catch {
    // Best-effort: this event stays `pending` and is retried by the next reconcile pass.
  }
}

/**
 * Catch-up path for any `domain_events` row that stayed `pending` — the synchronous dispatch
 * above threw, or (more likely in practice) simply never ran because the notification system did
 * not exist yet when the event was written. Triggered opportunistically from both
 * `/manager/notifications` and `/employee/notifications` reads, and from the app shell layouts on
 * every page view (see the time-based reconcile below), rather than a durable job runner — this
 * project has none before Phase 20.
 */
export async function reconcilePendingDomainEventNotifications(
  organizationId: string,
  limit = 100,
): Promise<void> {
  const pending = await getDb()
    .select()
    .from(domainEvents)
    .where(
      and(
        eq(domainEvents.organizationId, organizationId),
        eq(domainEvents.processingStatus, "pending"),
      ),
    )
    .orderBy(asc(domainEvents.occurredAt))
    .limit(limit);
  for (const row of pending) {
    await dispatchNotificationsForDomainEvent({
      id: row.id,
      organizationId: row.organizationId,
      locationId: row.locationId,
      type: row.type as DomainEventRecord["type"],
      subjectType: row.subjectType as DomainEventRecord["subjectType"],
      subjectId: row.subjectId,
      payload: row.payload,
      occurredAt: row.occurredAt,
    });
  }
}

/**
 * Runs the due-soon/overdue training and expiring-soon qualification scans for one organization,
 * guarded so real work happens at most once per organization per local calendar day: the first
 * caller on a given day wins an insert into `scheduled_job_runs` (its unique `(jobType,
 * organizationId, timeBucket)` index rejects everyone else), does the scan, then marks that run
 * `completed`; every other caller — same day, any number of concurrent requests — sees the
 * conflict and returns immediately. `timeBucket` uses the organization's own IANA timezone, not
 * UTC, so the boundary a new run becomes possible on is the organization's local midnight.
 */
export async function reconcileTimeBasedNotifications(
  organizationId: string,
  now: Date,
): Promise<void> {
  const [org] = await getDb()
    .select({ timezone: organizations.timezone })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org) return;
  const timeBucket = calendarDateInTimeZone(now, org.timezone);

  let runId: string | undefined;
  try {
    const [row] = await getDb()
      .insert(scheduledJobRuns)
      .values({
        id: randomUUID(),
        jobType: TIME_RECONCILE_JOB_TYPE,
        organizationId,
        timeBucket,
        status: "running",
        startedAt: now,
      })
      .returning({ id: scheduledJobRuns.id });
    runId = row?.id;
  } catch (error: unknown) {
    if (postgresCode(error) === "23505") return;
    throw error;
  }
  if (!runId) return;

  try {
    await scanAssignmentDueDates(organizationId, now);
    await scanExpiringQualifications(organizationId, now);
    await getDb()
      .update(scheduledJobRuns)
      .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(scheduledJobRuns.id, runId));
  } catch (error: unknown) {
    await getDb()
      .update(scheduledJobRuns)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(scheduledJobRuns.id, runId));
    throw error;
  }
}

/** Best-effort wrapper for the app shell layouts: a failure here must never break page render. */
export async function reconcileTimeBasedNotificationsBestEffort(
  organizationId: string,
): Promise<void> {
  try {
    await reconcileTimeBasedNotifications(organizationId, new Date());
  } catch {
    // Best-effort: the next page view (by this user or anyone else in the org) retries.
  }
}

async function scanAssignmentDueDates(organizationId: string, now: Date): Promise<void> {
  const dueSoonThreshold = new Date(now.getTime() + DUE_SOON_WINDOW_MS);
  const rows = await getDb()
    .select({
      id: trainingAssignments.id,
      locationId: trainingAssignments.locationId,
      employeeId: trainingAssignments.employeeId,
      employeeStatus: employees.status,
      dueAt: trainingAssignments.dueAt,
      dueTimezone: trainingAssignments.dueTimezone,
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
        inArray(trainingAssignments.status, ["assigned", "in_progress"]),
        lte(trainingAssignments.dueAt, dueSoonThreshold),
      ),
    );

  for (const row of rows) {
    if (row.employeeStatus !== "active" || !row.dueAt) continue;
    const overdue = row.dueAt.getTime() < now.getTime();
    const dueDate = calendarDateInTimeZone(row.dueAt, row.dueTimezone ?? "UTC");
    await createNotification({
      organizationId,
      locationId: row.locationId,
      recipientType: "employee",
      recipientId: row.employeeId,
      type: overdue ? "training.overdue" : "training.due_soon",
      subjectType: "training_assignment",
      subjectId: row.id,
      params: { sopTitle: row.sopTitle, dueDate },
      internalPath: `/employee/training/${row.id}`,
      dedupeKey: `${overdue ? "overdue" : "due_soon"}:${row.id}`,
    });
  }
}

async function scanExpiringQualifications(organizationId: string, now: Date): Promise<void> {
  const expiringThreshold = new Date(now.getTime() + EXPIRING_SOON_WINDOW_MS);
  const rows = await getDb()
    .select({
      id: employeeQualifications.id,
      locationId: employees.primaryLocationId,
      employeeId: employeeQualifications.employeeId,
      employeeStatus: employees.status,
      expiresAt: employeeQualifications.expiresAt,
      definitionName: qualificationDefinitions.name,
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
        eq(employeeQualifications.status, "active"),
        lte(employeeQualifications.expiresAt, expiringThreshold),
      ),
    );

  for (const row of rows) {
    if (row.employeeStatus !== "active" || !row.expiresAt) continue;
    if (row.expiresAt.getTime() <= now.getTime()) continue; // already expired, not "expiring soon"
    await createNotification({
      organizationId,
      locationId: row.locationId,
      recipientType: "employee",
      recipientId: row.employeeId,
      type: "qualification.expiring_soon",
      subjectType: "employee_qualification",
      subjectId: row.id,
      params: {
        definitionName: row.definitionName,
        dueDate: calendarDateInTimeZone(row.expiresAt, "UTC"),
      },
      internalPath: `/employee/qualifications/${row.id}`,
      dedupeKey: `qualification_expiring:${row.id}`,
    });
  }
}

export interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  internalPath: string;
  locationId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

function toNotificationRow(row: {
  id: string;
  type: string;
  params: Record<string, string | number | boolean | null>;
  internalPath: string;
  locationId: string | null;
  readAt: Date | null;
  createdAt: Date;
}): NotificationRow {
  const type = row.type as NotificationType;
  const { title, body } = resolveNotificationText(type, row.params);
  return {
    id: row.id,
    type,
    title,
    body,
    internalPath: row.internalPath,
    locationId: row.locationId,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

async function listNotifications(
  recipientType: "manager" | "employee",
  recipientId: string,
  query: NotificationQuery,
): Promise<{ items: NotificationRow[]; total: number; page: number; pageSize: number }> {
  const conditions: SQL[] = [
    eq(notifications.recipientType, recipientType),
    eq(notifications.recipientId, recipientId),
  ];
  if (query.type) conditions.push(eq(notifications.type, query.type));
  if (query.unreadOnly === "1") conditions.push(sql`${notifications.readAt} is null`);

  const db = getDb();
  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: notifications.id,
        type: notifications.type,
        params: notifications.params,
        internalPath: notifications.internalPath,
        locationId: notifications.locationId,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(...conditions)),
  ]);

  return {
    items: rows.map(toNotificationRow),
    total: totalRows[0]?.count ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/**
 * A manager's own notification inbox. `recipientId` is that manager's `manager_memberships.id`;
 * org/location scoping already happened at generation time (`getLocationRecipientManagers` only
 * ever fans a notification out to managers who can manage the triggering location), so this is
 * simply "notifications addressed to me", not a further-filtered list.
 */
export async function listNotificationsForManager(
  actor: ManagerSessionContext,
  query: NotificationQuery,
): Promise<{ items: NotificationRow[]; total: number; page: number; pageSize: number }> {
  await reconcilePendingDomainEventNotifications(actor.organizationId).catch(() => undefined);
  return listNotifications("manager", actor.membershipId, query);
}

export async function listNotificationsForEmployee(
  session: EmployeeSessionContext,
  query: NotificationQuery,
): Promise<{ items: NotificationRow[]; total: number; page: number; pageSize: number }> {
  await reconcilePendingDomainEventNotifications(session.organizationId).catch(() => undefined);
  return listNotifications("employee", session.employeeId, query);
}

async function markNotificationRead(
  organizationId: string,
  recipientType: "manager" | "employee",
  recipientId: string,
  notificationId: string,
): Promise<void> {
  const [row] = await getDb()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.organizationId, organizationId),
        eq(notifications.recipientType, recipientType),
        eq(notifications.recipientId, recipientId),
        sql`${notifications.readAt} is null`,
      ),
    )
    .returning({ id: notifications.id });
  if (!row) {
    // Either the notification does not belong to this recipient, does not exist, or was already
    // read — indistinguishable on purpose, and marking an already-read notification read again is
    // harmless, so this only rejects the "not found or not yours" case.
    const [existing] = await getDb()
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.organizationId, organizationId),
          eq(notifications.recipientType, recipientType),
          eq(notifications.recipientId, recipientId),
        ),
      )
      .limit(1);
    if (!existing) throw new AppError("NOT_FOUND", "Notification not found.");
  }
}

export async function markManagerNotificationRead(
  actor: ManagerSessionContext,
  notificationId: string,
): Promise<void> {
  await markNotificationRead(actor.organizationId, "manager", actor.membershipId, notificationId);
}

export async function markEmployeeNotificationRead(
  session: EmployeeSessionContext,
  notificationId: string,
): Promise<void> {
  await markNotificationRead(
    session.organizationId,
    "employee",
    session.employeeId,
    notificationId,
  );
}
