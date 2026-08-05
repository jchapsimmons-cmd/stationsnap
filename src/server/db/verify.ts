import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import EmbeddedPostgres from "embedded-postgres";
import { Pool } from "pg";
import { PDFDocument } from "pdf-lib";
import { GET as healthCheck } from "@/app/api/health/route";
import manifest from "@/app/manifest";
import { calendarDateInTimeZone, endOfDayInTimeZone } from "@/lib/timezone";
import { changeManagerRole, disableManagerAccount, resetEmployeePin } from "@/server/auth/admin";
import { managerCanAccessLocation, requireManagerLocation } from "@/server/auth/authorization";
import { createOpaqueToken, hashToken, verifySecret } from "@/server/auth/crypto";
import {
  assertLoginAllowed,
  createRateLimitKey,
  recordLoginFailure,
} from "@/server/auth/rate-limit";
import { completeManagerPasswordReset, loginEmployee, loginManager } from "@/server/auth/service";
import {
  createManagerSession,
  getEmployeeSession,
  getManagerSession,
  type EmployeeSessionContext,
  type ManagerSessionContext,
} from "@/server/auth/sessions";
import { closeDatabase, getDb, getPool } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import {
  auditEvents,
  employeeSessions,
  employees,
  locations,
  managerMemberships,
  managerSessions,
  organizations,
  passwordResetTokens,
} from "@/server/db/schema";
import { runSeed } from "@/server/db/seed";
import { employeeSeed, managerSeed, seedIds } from "@/server/db/seed-data";
import {
  createEmployee,
  createLocation,
  createStation,
  getLocationRecipientManagers,
  getStationForEmployee,
  listEmployees,
  listStationsForEmployee,
  setManagerLocationAssignments,
  updateEmployee,
  updateLocation,
  updateOrganization,
  updateStation,
} from "@/server/management/service";
import {
  approvalDecisions,
  approvalSubmissions,
  checklistItems,
  correctionRequests,
  domainEvents,
  employeeQualifications,
  files as filesTable,
  notificationDeliveries,
  notifications,
  qrScanEvents,
  qualificationSupportingSessions,
  scheduledJobRuns,
  translations as translationsTable,
  trainingAssignments,
} from "@/server/db/schema";
import { domainEventTypeValues, listActivity, type DomainEventRecord } from "@/server/events";
import {
  dispatchNotificationsForDomainEvent,
  listNotificationsForEmployee,
  listNotificationsForManager,
  markEmployeeNotificationRead,
  markManagerNotificationRead,
  reconcilePendingDomainEventNotifications,
  reconcileTimeBasedNotifications,
} from "@/server/notifications/service";
import { getApprovalHistoryReport } from "@/server/reports";
import {
  createQrCode,
  getQrCode,
  listQrCodes,
  resolveQrCode,
  revokeQrCode,
  rotateQrCode,
} from "@/server/qr/service";
import {
  archiveSop,
  autosaveSopDraft,
  compareSopVersions,
  createDraftFromCurrentVersion,
  createSop,
  createStep,
  createTrainingQuestion,
  deleteStep,
  deleteTrainingQuestion,
  duplicateStep,
  getPublishedSopForEmployee,
  getPublishReadiness,
  getSop,
  getSopDraft,
  getSopVersionDetail,
  getSopVersionForPrint,
  getSopVersionHistoryReport,
  getStepTrainingRequirementsDraft,
  getTrainingConfigDraft,
  getTrainingQuestion,
  getTrainingQuestionsDraft,
  hasDraftVersion,
  listPublishedSopsForEmployee,
  listRecentSopsForEmployee,
  listSops,
  listSopVersions,
  previewSop,
  publishSop,
  reorderSteps,
  reorderTrainingQuestions,
  restoreSopVersion,
  updateStep,
  updateStepTrainingRequirements,
  updateTrainingConfig,
  updateTrainingQuestion,
} from "@/server/sops/service";
import {
  approveTranslation,
  getLocalizedSopForEmployee,
  getTranslationMatrix,
  upsertTranslation,
} from "@/server/sops/translations";
import { getMediaFile, getMediaFileForEmployee, uploadMedia } from "@/server/storage/media-service";
import { decideChecklistRun } from "@/server/checklists/approvals";
import {
  getChecklistCompletionReport,
  getChecklistRunDetail,
  listChecklistRuns,
  recordItemAction,
  saveItemNote,
  startOrResumeRun,
  submitChecklistRun,
  submitItemEvidence,
} from "@/server/checklists/runs";
import {
  createChecklist,
  getChecklistDetail,
  getChecklistForEmployee,
  listChecklists,
  updateChecklist,
} from "@/server/checklists/service";
import {
  decideApprovalSubmission,
  getApprovalSubmissionDetail,
  getEmployeeCorrectionDetail,
  listApprovalQueue,
  resubmitCorrection,
} from "@/server/training/approvals";
import {
  createPath,
  getPathDetail,
  getQualificationDetail,
  getQualificationDetailForEmployee,
  getQualificationsReport,
  listPaths,
  listQualificationsForEmployee,
  listQualificationsOverview,
  revokeQualification,
  updatePath,
} from "@/server/training/qualifications";
import { approvalDecisionSchema } from "@/server/training/schemas";
import {
  assignTraining,
  getAssignmentDetail,
  getManagerAssignmentDetail,
  getSessionState,
  getTrainingProgressReport,
  getTrainingSessionForPrint,
  recordStepAction,
  startOrResumeSession,
  submitAnswer,
  submitSession,
  submitStepEvidence,
} from "@/server/training/service";
import {
  approvalHistoryReportToCsv,
  checklistCompletionReportToCsv,
  qualificationsReportToCsv,
  sopVersionHistoryReportToCsv,
  trainingProgressReportToCsv,
} from "@/server/print/csv-export";
import {
  renderChecklistRunPdf,
  renderQualificationPdf,
  renderSopVersionPdf,
  renderTrainingSessionPdf,
} from "@/server/print/pdf";

const port = 55_439;
const database = "stationsnap_verify";
const user = "postgres";
const password = randomBytes(24).toString("base64url");

const postgres = new EmbeddedPostgres({
  databaseDir: path.resolve(".tmp", "postgres-verification"),
  port,
  user,
  password,
  persistent: false,
  onLog: () => undefined,
  // Some CI/agent containers run this script as root, under which PostgreSQL's own initdb
  // refuses to run. embedded-postgres handles that by dropping privileges to a "postgres"
  // system user (creating one if needed) and pre-creating/chowning the data directory for it.
  // This is a no-op when the process is not root: embedded-postgres only consults it there.
  createPostgresUser: true,
});

async function verifyUpgradeMigration(): Promise<void> {
  const upgradeDatabase = "stationsnap_upgrade";
  await postgres.createDatabase(upgradeDatabase);
  const pool = new Pool({
    connectionString: `postgresql://${user}:${password}@localhost:${port}/${upgradeDatabase}`,
  });
  // See the matching comment in src/server/db/client.ts: an unhandled 'error' event on a
  // pg Pool crashes the process, so every ad-hoc Pool needs its own listener too.
  pool.on("error", () => undefined);
  try {
    await pool.query(
      await readFile(path.resolve("drizzle", "0000_colossal_sugar_man.sql"), "utf8"),
    );
    await pool.query(
      `insert into organizations (id, name, timezone) values ($1, 'Existing Organization', 'America/Chicago')`,
      ["80000000-0000-4000-8000-000000000001"],
    );
    await pool.query(
      `insert into locations (id, organization_id, name, timezone) values ($1, $2, 'Existing Location', 'America/Chicago')`,
      ["80000000-0000-4000-8000-000000000002", "80000000-0000-4000-8000-000000000001"],
    );
    await pool.query(
      await readFile(path.resolve("drizzle", "0001_hard_squadron_supreme.sql"), "utf8"),
    );
    await pool.query(await readFile(path.resolve("drizzle", "0002_lumpy_arachne.sql"), "utf8"));
    await pool.query(await readFile(path.resolve("drizzle", "0003_curvy_vampiro.sql"), "utf8"));
    await pool.query(
      await readFile(path.resolve("drizzle", "0004_phase4_sop_builder.sql"), "utf8"),
    );
    await pool.query(
      await readFile(path.resolve("drizzle", "0005_phase5_versions_and_retraining.sql"), "utf8"),
    );
    const result = await pool.query<{ organization_slug: string; location_slug: string }>(
      `select o.access_slug as organization_slug, l.access_slug as location_slug from organizations o join locations l on l.organization_id = o.id`,
    );
    if (!result.rows[0]?.organization_slug || !result.rows[0]?.location_slug) {
      throw new Error("Phase 1 to Phase 2 migration did not backfill access slugs");
    }
  } finally {
    await pool.end();
  }
}

/**
 * Creates and publishes a minimal SOP that auto-passes: one step with no per-step requirements
 * and no questions, `required`/`learn`/no evidence-approval training. An employee who starts a
 * session against it can submit immediately (every default step requirement is already
 * satisfied), which is exactly what the Phase 11 qualification fixtures need — bare completions
 * to feed the award algorithm without exercising the Phase 8 requirement engine again.
 */
async function createMinimalPublishedSop(
  actor: ManagerSessionContext,
  title: string,
  locationId: string,
  prefix: string,
) {
  const draft = await createSop(
    actor,
    {
      title,
      description: `${title} minimal auto-pass fixture`,
      category: "general_procedure",
      locationId,
      stationId: null,
      estimatedMinutes: 5,
      difficulty: "beginner",
      coverImageFileId: null,
      sourceVideoFileId: null,
      materials: [],
      warnings: [],
    },
    `${prefix}-sop-create`,
  );
  const stepDraft = await createStep(
    actor,
    draft.id,
    {
      title: "Complete the procedure",
      instruction: `Complete ${title}.`,
      imageFileId: null,
      videoFileId: null,
      warning: "",
      quantity: "",
      unit: "",
      equipmentSetting: "",
      timerSeconds: null,
      isRequired: true,
      expectedRevision: draft.version.revision,
    },
    `${prefix}-step-create`,
  );
  const config = await updateTrainingConfig(
    actor,
    draft.id,
    {
      requirementState: "required",
      defaultMode: "learn",
      allowBacktracking: true,
      requireSequentialProgress: true,
      requireFullVideoWatch: false,
      requireEvidenceApproval: false,
      passingScorePercent: 80,
      maxAttempts: 3,
      qualificationValidityDays: null,
      retrainingGraceDays: null,
      expectedRevision: stepDraft.version.revision,
    },
    `${prefix}-config-save`,
  );
  const published = await publishSop(
    actor,
    draft.id,
    { expectedRevision: config.revision, changeSummary: "", retrainingRule: { type: "none" } },
    `${prefix}-publish`,
  );
  if (published.status !== "published" || !published.currentVersionId) {
    throw new Error(`Publishing the "${title}" Phase 11 fixture did not succeed`);
  }
  return published;
}

/** Starts and immediately submits a session against a `createMinimalPublishedSop` assignment. */
async function completeMinimalAssignment(
  session: EmployeeSessionContext,
  assignmentId: string,
  prefix: string,
) {
  const started = await startOrResumeSession(session, assignmentId, `${prefix}-start`);
  const submitted = await submitSession(
    session,
    assignmentId,
    started.id,
    started.revision,
    `${prefix}-submit`,
  );
  if (submitted.status !== "passed") {
    throw new Error(`The "${prefix}" Phase 11 fixture assignment did not pass`);
  }
  return submitted;
}

/** Logs an employee in by number/PIN, used to build fresh employee sessions for Phase 11 fixtures. */
async function loginNewEmployee(
  employeeNumber: string,
  pin: string,
  prefix: string,
): Promise<EmployeeSessionContext> {
  const login = await loginEmployee(
    { organizationSlug: "stationsnap-demo", locationSlug: "downtown", employeeNumber, pin },
    { ipHash: `verify-ip-${prefix}`, requestId: `verify-${prefix}-login` },
  );
  const context = await getEmployeeSession(login.token);
  if (!context) throw new Error(`The "${prefix}" Phase 11 employee session verification failed`);
  return context;
}

/**
 * Structural validity check for a Phase 15 print PDF: a correct header plus a full round-trip
 * re-parse through pdf-lib's own reader, confirming the byte stream `renderXPdf` produced is a
 * real, loadable multi-object PDF document with at least one page — not just a plausible-looking
 * prefix. Text-content fidelity (the right title/name/score actually appears on the page) is
 * covered by the dedicated `src/server/print/pdf.test.ts` unit suite via `pdf-parse`; that
 * extraction library's bundled pdf.js is not safe to invoke from this script's `tsx` runtime, so
 * this check deliberately stays structural rather than duplicating that extraction here.
 */
async function assertValidPdf(bytes: Uint8Array, label: string): Promise<void> {
  if (Buffer.from(bytes).subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new Error(`${label} did not start with a valid PDF header`);
  }
  const reloaded = await PDFDocument.load(bytes);
  if (reloaded.getPageCount() === 0) {
    throw new Error(`${label} round-tripped through pdf-lib with zero pages`);
  }
}

async function verifyDatabase(): Promise<void> {
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase(database);

  const managerPassword = randomBytes(24).toString("base64url");
  const employeePin = String(Math.floor(1000 + Math.random() * 9000));
  Object.assign(process.env, {
    DATABASE_URL: `postgresql://${user}:${password}@localhost:${port}/${database}`,
    LOG_LEVEL: "silent",
    NODE_ENV: "test",
    SEED_MANAGER_PASSWORD: managerPassword,
    SEED_EMPLOYEE_PIN: employeePin,
  });

  await runMigrations();

  // Concurrent deploys (e.g. two Vercel builds landing close together) must not
  // race DDL against each other; the advisory lock in runMigrations should
  // serialize them safely rather than erroring or corrupting migration state.
  const concurrentMigrationResults = await Promise.allSettled([runMigrations(), runMigrations()]);
  if (concurrentMigrationResults.some((result) => result.status === "rejected")) {
    throw new Error("Concurrent migration runs failed under the advisory lock");
  }

  await runSeed();

  const result = await getPool().query<{
    organizations: number;
    locations: number;
    stations: number;
    managers: number;
    employees: number;
  }>(`select
      (select count(*)::int from organizations) as organizations,
      (select count(*)::int from locations) as locations,
      (select count(*)::int from stations) as stations,
      (select count(*)::int from manager_users) as managers,
      (select count(*)::int from employees) as employees`);

  const counts = result.rows[0];
  if (
    !counts ||
    counts.organizations !== 1 ||
    counts.locations !== 2 ||
    counts.stations !== 4 ||
    counts.managers !== 3 ||
    counts.employees !== 5
  ) {
    throw new Error(`Unexpected seed counts: ${JSON.stringify(counts)}`);
  }

  const credentialResult = await getPool().query<{ password_hash: string; pin_hash: string }>(
    `select m.password_hash, e.pin_hash from manager_users m cross join employees e where m.id = $1 and e.id = $2`,
    [seedIds.managers.owner, employeeSeed[0].id],
  );
  const credentials = credentialResult.rows[0];
  if (
    !credentials ||
    credentials.password_hash === managerPassword ||
    credentials.pin_hash === employeePin ||
    !(await verifySecret(managerPassword, credentials.password_hash)) ||
    !(await verifySecret(employeePin, credentials.pin_hash))
  ) {
    throw new Error("Seed credentials were not hashed correctly");
  }

  const managerLogin = await loginManager(
    { email: managerSeed[0].email, password: managerPassword },
    { ipHash: "verify-ip-manager", requestId: "verify-manager-login" },
  );
  const managerContext = await getManagerSession(managerLogin.token);
  if (!managerContext || managerContext.role !== "owner")
    throw new Error("Manager session verification failed");
  const expiredSession = await createManagerSession({
    organizationId: seedIds.organization,
    membershipId: seedIds.memberships.owner,
    managerUserId: seedIds.managers.owner,
    now: new Date(Date.now() - 13 * 60 * 60 * 1000),
  });
  if (await getManagerSession(expiredSession.token)) {
    throw new Error("Expired manager session was accepted");
  }

  const employeeLogin = await loginEmployee(
    {
      organizationSlug: "stationsnap-demo",
      locationSlug: "downtown",
      employeeNumber: employeeSeed[0].employeeNumber,
      pin: employeePin,
    },
    { ipHash: "verify-ip-employee", requestId: "verify-employee-login" },
  );
  const employeeContext = await getEmployeeSession(employeeLogin.token);
  if (!employeeContext || employeeContext.organizationId !== seedIds.organization) {
    throw new Error("Employee session verification failed");
  }

  const scopedManagerLogin = await loginManager(
    { email: managerSeed[1].email, password: managerPassword },
    { ipHash: "verify-ip-scoped-manager", requestId: "verify-scoped-manager-login" },
  );
  const scopedManagerContext = await getManagerSession(scopedManagerLogin.token);
  if (
    !scopedManagerContext ||
    !(await managerCanAccessLocation(scopedManagerContext, seedIds.locations.downtown)) ||
    (await managerCanAccessLocation(scopedManagerContext, seedIds.locations.riverside))
  ) {
    throw new Error("Manager location restrictions failed");
  }
  let unauthorizedLocationRejected = false;
  try {
    await requireManagerLocation(
      scopedManagerContext,
      seedIds.locations.riverside,
      "verify-unauthorized-location",
    );
  } catch {
    unauthorizedLocationRejected = true;
  }
  if (!unauthorizedLocationRejected) throw new Error("Unauthorized location access was accepted");

  let managerOrganizationWriteRejected = false;
  try {
    await updateOrganization(scopedManagerContext, {
      name: "Unauthorized rename",
      logoUrl: null,
      defaultLanguage: "en",
      timezone: "America/Chicago",
      status: "active",
    });
  } catch {
    managerOrganizationWriteRejected = true;
  }
  if (!managerOrganizationWriteRejected) throw new Error("Manager changed organization settings");

  const phaseThreeLocation = await createLocation(managerContext, {
    name: "Airport",
    accessSlug: "airport",
    timezone: "America/Chicago",
    status: "active",
  });
  await updateOrganization(managerContext, {
    name: "StationSnap Demo Kitchen",
    logoUrl: "https://example.com/stationsnap-logo.png",
    defaultLanguage: "es",
    timezone: "America/Chicago",
    status: "active",
  });
  let managerLocationCreateRejected = false;
  try {
    await createLocation(scopedManagerContext, {
      name: "Unauthorized",
      accessSlug: "unauthorized",
      timezone: "America/Chicago",
      status: "active",
    });
  } catch {
    managerLocationCreateRejected = true;
  }
  if (!managerLocationCreateRejected) throw new Error("Manager created an organization location");

  const phaseThreeStation = await createStation(scopedManagerContext, {
    locationId: seedIds.locations.downtown,
    name: "Dish Area",
    description: "Dishwashing and sanitation procedures",
    imageUrl: "https://example.com/dish-area.png",
    displayOrder: 3,
    status: "active",
  });
  let scopedStationWriteRejected = false;
  try {
    await createStation(scopedManagerContext, {
      locationId: seedIds.locations.riverside,
      name: "Unauthorized Station",
      description: "",
      imageUrl: null,
      displayOrder: 3,
      status: "active",
    });
  } catch {
    scopedStationWriteRejected = true;
  }
  if (!scopedStationWriteRejected) throw new Error("Manager created a station outside their scope");

  const phaseThreePin = "8642";
  const phaseThreeEmployee = await createEmployee(scopedManagerContext, {
    primaryLocationId: seedIds.locations.downtown,
    employeeNumber: "1099",
    displayName: "Jamie Phase Three",
    jobRole: "Dishwasher",
    language: "en",
    pin: phaseThreePin,
    status: "active",
  });
  const [phaseThreeCredential] = await getDb()
    .select({ pinHash: employees.pinHash })
    .from(employees)
    .where(eq(employees.id, phaseThreeEmployee.id));
  if (
    !phaseThreeCredential?.pinHash ||
    phaseThreeCredential.pinHash === phaseThreePin ||
    !(await verifySecret(phaseThreePin, phaseThreeCredential.pinHash))
  ) {
    throw new Error("Phase 3 employee PIN was not securely hashed");
  }
  const employeeSearch = await listEmployees(scopedManagerContext, {
    search: "Jamie Phase",
    locationId: seedIds.locations.downtown,
    status: "active",
  });
  if (employeeSearch.length !== 1 || employeeSearch[0]?.id !== phaseThreeEmployee.id) {
    throw new Error("Employee search and filters failed");
  }
  let scopedEmployeeMoveRejected = false;
  try {
    await updateEmployee(scopedManagerContext, phaseThreeEmployee.id, {
      primaryLocationId: seedIds.locations.riverside,
      employeeNumber: phaseThreeEmployee.employeeNumber,
      displayName: phaseThreeEmployee.displayName,
      jobRole: phaseThreeEmployee.jobRole,
      language: phaseThreeEmployee.language,
      status: phaseThreeEmployee.status,
    });
  } catch {
    scopedEmployeeMoveRejected = true;
  }
  if (!scopedEmployeeMoveRejected) throw new Error("Manager moved an employee outside their scope");
  await updateEmployee(scopedManagerContext, phaseThreeEmployee.id, {
    primaryLocationId: seedIds.locations.downtown,
    employeeNumber: phaseThreeEmployee.employeeNumber,
    displayName: phaseThreeEmployee.displayName,
    jobRole: phaseThreeEmployee.jobRole,
    language: phaseThreeEmployee.language,
    status: "disabled",
  });
  let disabledPhaseThreeLoginRejected = false;
  try {
    await loginEmployee(
      {
        organizationSlug: "stationsnap-demo",
        locationSlug: "downtown",
        employeeNumber: phaseThreeEmployee.employeeNumber,
        pin: phaseThreePin,
      },
      { ipHash: "verify-phase-three-disabled", requestId: "verify-phase-three-disabled" },
    );
  } catch {
    disabledPhaseThreeLoginRejected = true;
  }
  if (!disabledPhaseThreeLoginRejected) throw new Error("Disabled Phase 3 employee logged in");
  await updateLocation(managerContext, phaseThreeLocation.id, {
    name: phaseThreeLocation.name,
    accessSlug: phaseThreeLocation.accessSlug,
    timezone: phaseThreeLocation.timezone,
    status: "disabled",
  });
  await setManagerLocationAssignments(managerContext, seedIds.memberships.downtown, [
    seedIds.locations.downtown,
    seedIds.locations.riverside,
  ]);
  if (!(await managerCanAccessLocation(scopedManagerContext, seedIds.locations.riverside))) {
    throw new Error("Manager location assignment did not take effect");
  }
  await setManagerLocationAssignments(managerContext, seedIds.memberships.downtown, [
    seedIds.locations.downtown,
  ]);
  if (await managerCanAccessLocation(scopedManagerContext, seedIds.locations.riverside)) {
    throw new Error("Removed manager location assignment remained active");
  }
  if (!phaseThreeStation.id) throw new Error("Phase 3 station creation failed");

  await changeManagerRole(
    managerContext,
    { membershipId: seedIds.memberships.downtown, role: "owner" },
    "verify-role-promotion",
  );
  await changeManagerRole(
    managerContext,
    { membershipId: seedIds.memberships.downtown, role: "manager" },
    "verify-role-demotion",
  );

  await disableManagerAccount(
    managerContext,
    seedIds.memberships.downtown,
    "verify-disable-manager",
  );
  if (await getManagerSession(scopedManagerLogin.token)) {
    throw new Error("Disabled manager membership retained session access");
  }
  await getDb()
    .update(managerMemberships)
    .set({ status: "active" })
    .where(eq(managerMemberships.id, seedIds.memberships.downtown));
  let lastOwnerProtected = false;
  try {
    await disableManagerAccount(managerContext, seedIds.memberships.owner, "verify-last-owner");
  } catch {
    lastOwnerProtected = true;
  }
  if (!lastOwnerProtected) throw new Error("Last active owner could be disabled");

  const resetTargetLogin = await loginManager(
    { email: managerSeed[2].email, password: managerPassword },
    { ipHash: "verify-ip-reset-manager", requestId: "verify-reset-manager-login" },
  );
  const resetToken = createOpaqueToken();
  await getDb()
    .insert(passwordResetTokens)
    .values({
      id: randomUUID(),
      managerUserId: seedIds.managers.riverside,
      tokenHash: hashToken(resetToken),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
  const replacementPassword = randomBytes(24).toString("base64url");
  await completeManagerPasswordReset(
    { token: resetToken, password: replacementPassword },
    "verify-password-reset",
  );
  if (await getManagerSession(resetTargetLogin.token)) {
    throw new Error("Password reset did not revoke manager sessions");
  }
  const resetManagerLogin = await loginManager(
    { email: managerSeed[2].email, password: replacementPassword },
    { ipHash: "verify-ip-reset-manager-new", requestId: "verify-reset-manager-new-login" },
  );
  if (!(await getManagerSession(resetManagerLogin.token))) {
    throw new Error("Manager password reset login failed");
  }

  const replacementPin = String(((Number(employeePin) + 1_111) % 9_000) + 1_000).slice(-4);
  let failedPinRejected = false;
  try {
    await loginEmployee(
      {
        organizationSlug: "stationsnap-demo",
        locationSlug: "downtown",
        employeeNumber: employeeSeed[0].employeeNumber,
        pin: replacementPin,
      },
      { ipHash: "verify-ip-failed-pin", requestId: "verify-failed-pin" },
    );
  } catch {
    failedPinRejected = true;
  }
  if (!failedPinRejected) throw new Error("Incorrect employee PIN was accepted");
  await resetEmployeePin(
    managerContext,
    { employeeId: employeeSeed[0].id, pin: replacementPin },
    "verify-pin-reset",
  );
  if (await getEmployeeSession(employeeLogin.token))
    throw new Error("PIN reset did not revoke employee sessions");
  const replacementLogin = await loginEmployee(
    {
      organizationSlug: "stationsnap-demo",
      locationSlug: "downtown",
      employeeNumber: employeeSeed[0].employeeNumber,
      pin: replacementPin,
    },
    { ipHash: "verify-ip-employee-replacement", requestId: "verify-employee-replacement-login" },
  );
  if (!(await getEmployeeSession(replacementLogin.token)))
    throw new Error("Employee PIN reset login failed");

  await getDb()
    .update(employees)
    .set({ status: "disabled" })
    .where(eq(employees.id, employeeSeed[0].id));
  if (await getEmployeeSession(replacementLogin.token))
    throw new Error("Disabled employee retained session access");
  await getDb()
    .update(employees)
    .set({ status: "active" })
    .where(eq(employees.id, employeeSeed[0].id));

  const otherOrganizationId = "70000000-0000-4000-8000-000000000001";
  const otherLocationId = "70000000-0000-4000-8000-000000000002";
  await getDb().insert(organizations).values({
    id: otherOrganizationId,
    accessSlug: "other-organization",
    name: "Other Organization",
    timezone: "America/New_York",
  });
  await getDb().insert(locations).values({
    id: otherLocationId,
    organizationId: otherOrganizationId,
    accessSlug: "other-location",
    name: "Other Location",
    timezone: "America/New_York",
  });
  let crossTenantAssignmentRejected = false;
  try {
    await setManagerLocationAssignments(managerContext, seedIds.memberships.downtown, [
      otherLocationId,
    ]);
  } catch {
    crossTenantAssignmentRejected = true;
  }
  if (!crossTenantAssignmentRejected) throw new Error("Cross-tenant manager assignment succeeded");
  if (await managerCanAccessLocation(managerContext, otherLocationId)) {
    throw new Error("Cross-organization owner access was incorrectly allowed");
  }
  let crossTenantConstraintRejected = false;
  try {
    await getDb().insert(employees).values({
      id: "70000000-0000-4000-8000-000000000003",
      organizationId: seedIds.organization,
      primaryLocationId: otherLocationId,
      employeeNumber: "cross-tenant",
      displayName: "Invalid Employee",
      jobRole: "Invalid",
    });
  } catch {
    crossTenantConstraintRejected = true;
  }
  if (!crossTenantConstraintRejected)
    throw new Error("Cross-tenant database relationship was accepted");

  let mismatchedManagerSessionRejected = false;
  try {
    await getDb()
      .insert(managerSessions)
      .values({
        id: randomUUID(),
        organizationId: seedIds.organization,
        membershipId: seedIds.memberships.owner,
        managerUserId: seedIds.managers.downtown,
        tokenHash: hashToken(createOpaqueToken()),
        expiresAt: new Date(Date.now() + 60_000),
      });
  } catch {
    mismatchedManagerSessionRejected = true;
  }
  if (!mismatchedManagerSessionRejected) {
    throw new Error("Mismatched manager identity and membership were accepted");
  }

  let mismatchedEmployeeLocationRejected = false;
  try {
    await getDb()
      .insert(employeeSessions)
      .values({
        id: randomUUID(),
        organizationId: seedIds.organization,
        locationId: seedIds.locations.riverside,
        employeeId: employeeSeed[0].id,
        tokenHash: hashToken(createOpaqueToken()),
        expiresAt: new Date(Date.now() + 60_000),
      });
  } catch {
    mismatchedEmployeeLocationRejected = true;
  }
  if (!mismatchedEmployeeLocationRejected) {
    throw new Error("Mismatched employee session location was accepted");
  }

  const rateKey = createRateLimitKey("employee", "verify-subject");
  for (let index = 0; index < 5; index += 1) await recordLoginFailure(rateKey);
  let lockoutEnforced = false;
  try {
    await assertLoginAllowed(rateKey);
  } catch {
    lockoutEnforced = true;
  }
  if (!lockoutEnforced) throw new Error("Login lockout was not enforced");

  // --- Phase 4: manual SOP builder ---

  const smallPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  // Not a playable video, but carries a real `ftyp` box so it clears the Phase 17 magic-byte
  // signature check the same way a genuine (if minimal) MP4 file would.
  const fakeMp4 = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from("ftypisom", "ascii"),
    Buffer.from("not-a-real-video", "ascii"),
  ]);
  async function uploadTestImage(actor: ManagerSessionContext) {
    const formData = new FormData();
    formData.set(
      "file",
      new File([new Uint8Array(smallPng)], "reference.png", { type: "image/png" }),
    );
    return uploadMedia(actor, formData, "verify-media-upload");
  }
  async function uploadTestVideo(actor: ManagerSessionContext) {
    const formData = new FormData();
    formData.set(
      "file",
      new File([new Uint8Array(fakeMp4)], "reference.mp4", {
        type: "video/mp4",
      }),
    );
    return uploadMedia(actor, formData, "verify-media-upload-video");
  }

  const cleanCover = await uploadTestImage(managerContext);
  if (cleanCover.status !== "ready") throw new Error("Media upload did not mark the file ready");

  let unsupportedTypeRejected = false;
  try {
    const badFormData = new FormData();
    badFormData.set(
      "file",
      new File([new Uint8Array(Buffer.from("not-a-real-file"))], "malware.exe", {
        type: "application/x-msdownload",
      }),
    );
    await uploadMedia(managerContext, badFormData, "verify-media-unsupported");
  } catch {
    unsupportedTypeRejected = true;
  }
  if (!unsupportedTypeRejected) throw new Error("An unsupported media type was accepted");

  const sopDraft = await createSop(
    managerContext,
    {
      title: "Grill line cleaning",
      description: "End of shift grill sanitation",
      category: "cleaning",
      locationId: seedIds.locations.downtown,
      stationId: seedIds.stations.grill,
      estimatedMinutes: 15,
      difficulty: "beginner",
      coverImageFileId: cleanCover.id,
      sourceVideoFileId: null,
      materials: [{ kind: "material", name: "Degreaser", quantity: "1", unit: "bottle" }],
      warnings: [{ text: "Grill surface may still be hot" }],
    },
    "verify-sop-create",
  );
  if (sopDraft.version.status !== "draft" || sopDraft.version.revision !== 1) {
    throw new Error("SOP creation did not start as a draft at revision 1");
  }

  let crossLocationStationRejected = false;
  try {
    await createSop(
      managerContext,
      {
        title: "Cross-location attempt",
        description: "",
        category: "cleaning",
        locationId: seedIds.locations.downtown,
        stationId: seedIds.stations.prep,
        estimatedMinutes: null,
        difficulty: "beginner",
        coverImageFileId: null,
        sourceVideoFileId: null,
        materials: [],
        warnings: [],
      },
      "verify-sop-cross-location-station",
    );
  } catch {
    crossLocationStationRejected = true;
  }
  if (!crossLocationStationRejected) {
    throw new Error("A station from another location was accepted on an SOP");
  }

  let scopedManagerCreateRejected = false;
  try {
    await createSop(
      scopedManagerContext,
      {
        title: "Unauthorized SOP",
        description: "",
        category: "cleaning",
        locationId: seedIds.locations.riverside,
        stationId: null,
        estimatedMinutes: null,
        difficulty: "beginner",
        coverImageFileId: null,
        sourceVideoFileId: null,
        materials: [],
        warnings: [],
      },
      "verify-sop-scoped-create-rejected",
    );
  } catch {
    scopedManagerCreateRejected = true;
  }
  if (!scopedManagerCreateRejected) {
    throw new Error("A location-restricted manager created an SOP outside their scope");
  }

  const autosaved = await autosaveSopDraft(
    managerContext,
    sopDraft.id,
    {
      title: "Grill line cleaning (updated)",
      expectedRevision: sopDraft.version.revision,
    },
    "verify-sop-autosave",
  );
  if (autosaved.version.title !== "Grill line cleaning (updated)") {
    throw new Error("SOP autosave did not persist the change");
  }
  if (autosaved.version.revision !== sopDraft.version.revision + 1) {
    throw new Error("SOP autosave did not advance the revision");
  }

  let staleAutosaveRejected = false;
  try {
    await autosaveSopDraft(
      managerContext,
      sopDraft.id,
      { title: "Duplicate tap", expectedRevision: sopDraft.version.revision },
      "verify-sop-autosave-stale",
    );
  } catch {
    staleAutosaveRejected = true;
  }
  if (!staleAutosaveRejected) {
    throw new Error("A stale-revision autosave (simulating a duplicate tap) was accepted");
  }

  const riversideManagerContext = await getManagerSession(resetManagerLogin.token);
  if (!riversideManagerContext) throw new Error("Riverside manager session verification failed");

  let unauthorizedLocationAutosaveRejected = false;
  try {
    await autosaveSopDraft(
      riversideManagerContext,
      sopDraft.id,
      { expectedRevision: autosaved.version.revision },
      "verify-sop-autosave-unauthorized",
    );
  } catch {
    unauthorizedLocationAutosaveRejected = true;
  }
  if (!unauthorizedLocationAutosaveRejected) {
    throw new Error("A location-restricted manager edited an SOP outside their scope");
  }

  let publishWithoutStepsRejected = false;
  try {
    await publishSop(
      managerContext,
      sopDraft.id,
      { changeSummary: "", retrainingRule: { type: "none" } },
      "verify-publish-no-steps",
    );
  } catch {
    publishWithoutStepsRejected = true;
  }
  if (!publishWithoutStepsRejected) {
    throw new Error("An SOP with no steps was allowed to publish");
  }

  const stepOne = await createStep(
    managerContext,
    sopDraft.id,
    {
      title: "Turn off burners",
      instruction: "Turn off every burner and let the grill cool.",
      imageFileId: null,
      videoFileId: null,
      warning: "",
      quantity: "",
      unit: "",
      equipmentSetting: "",
      timerSeconds: null,
      isRequired: true,
      expectedRevision: autosaved.version.revision,
    },
    "verify-sop-step-create",
  );
  const stepTwo = await createStep(
    managerContext,
    sopDraft.id,
    {
      title: "Scrape the grates",
      instruction: "Scrape grease from the grates into the bin.",
      imageFileId: null,
      videoFileId: null,
      warning: "Wear heat-resistant gloves",
      quantity: "",
      unit: "",
      equipmentSetting: "",
      timerSeconds: 120,
      isRequired: true,
      expectedRevision: stepOne.version.revision,
    },
    "verify-sop-step-create-2",
  );
  if (stepTwo.steps.length !== 2 || stepTwo.steps[1]?.timerSeconds !== 120) {
    throw new Error("Step creation and ordering failed");
  }

  const duplicated = await duplicateStep(
    managerContext,
    sopDraft.id,
    stepOne.steps[0]!.id,
    stepTwo.version.revision,
    "verify-sop-step-duplicate",
  );
  if (duplicated.steps.length !== 3) throw new Error("Step duplication failed");

  const reordered = await reorderSteps(
    managerContext,
    sopDraft.id,
    [duplicated.steps[2]!.id, duplicated.steps[0]!.id, duplicated.steps[1]!.id],
    duplicated.version.revision,
    "verify-sop-step-reorder",
  );
  if (
    reordered.steps[0]?.id !== duplicated.steps[2]!.id ||
    reordered.steps[0]?.displayOrder !== 1
  ) {
    throw new Error("Step reordering failed");
  }

  const afterDelete = await deleteStep(
    managerContext,
    sopDraft.id,
    reordered.steps[2]!.id,
    reordered.version.revision,
    "verify-sop-step-delete",
  );
  if (
    afterDelete.steps.length !== 2 ||
    afterDelete.steps.some((step, index) => step.displayOrder !== index + 1)
  ) {
    throw new Error("Step deletion did not renumber remaining steps");
  }

  const finalStep = await updateStep(
    managerContext,
    sopDraft.id,
    afterDelete.steps[1]!.id,
    {
      title: "Scrape and sanitize the grates",
      instruction: "Scrape grease from the grates and apply sanitizer.",
      imageFileId: null,
      videoFileId: null,
      warning: "Wear heat-resistant gloves",
      quantity: "",
      unit: "",
      equipmentSetting: "",
      timerSeconds: 180,
      isRequired: true,
      expectedRevision: afterDelete.version.revision,
    },
    "verify-sop-step-update",
  );
  if (finalStep.steps[1]?.timerSeconds !== 180) throw new Error("Step edit did not persist");

  const readiness = await getPublishReadiness(managerContext, sopDraft.id);
  if (!readiness.canPublish) {
    throw new Error(
      `SOP unexpectedly failed publish readiness: ${JSON.stringify(readiness.issues)}`,
    );
  }

  let staleExpectedRevisionPublishRejected = false;
  try {
    await publishSop(
      managerContext,
      sopDraft.id,
      {
        expectedRevision: finalStep.version.revision - 1,
        changeSummary: "",
        retrainingRule: { type: "none" },
      },
      "verify-publish-stale",
    );
  } catch {
    staleExpectedRevisionPublishRejected = true;
  }
  if (!staleExpectedRevisionPublishRejected) {
    throw new Error("Publishing with a stale expected revision was accepted");
  }

  const published = await publishSop(
    managerContext,
    sopDraft.id,
    {
      expectedRevision: finalStep.version.revision,
      changeSummary: "",
      retrainingRule: { type: "none" },
    },
    "verify-publish-success",
  );
  if (published.status !== "published" || published.version.status !== "published") {
    throw new Error("SOP publish did not mark the SOP and version as published");
  }
  if (!published.version.publishedAt) throw new Error("Publish did not record a publish timestamp");

  let publishedEditRejected = false;
  try {
    await autosaveSopDraft(
      managerContext,
      sopDraft.id,
      { title: "Should not apply", expectedRevision: published.version.revision },
      "verify-published-immutable-autosave",
    );
  } catch {
    publishedEditRejected = true;
  }
  if (!publishedEditRejected) throw new Error("A published SOP accepted an autosave edit");

  let publishedStepRejected = false;
  try {
    await createStep(
      managerContext,
      sopDraft.id,
      {
        title: "Should not be added",
        instruction: "This must not be allowed.",
        imageFileId: null,
        videoFileId: null,
        warning: "",
        quantity: "",
        unit: "",
        equipmentSetting: "",
        timerSeconds: null,
        isRequired: true,
        expectedRevision: published.version.revision,
      },
      "verify-published-immutable-step",
    );
  } catch {
    publishedStepRejected = true;
  }
  if (!publishedStepRejected) throw new Error("A published SOP accepted a new step");

  await archiveSop(managerContext, sopDraft.id, "verify-sop-archive");
  const archived = await getSop(managerContext, sopDraft.id);
  if (archived.status !== "archived") throw new Error("SOP archive did not update status");

  let doubleArchiveRejected = false;
  try {
    await archiveSop(managerContext, sopDraft.id, "verify-sop-archive-twice");
  } catch {
    doubleArchiveRejected = true;
  }
  if (!doubleArchiveRejected) throw new Error("An already-archived SOP was archived again");

  // A second draft SOP, left unpublished, to exercise library filters, search, and pagination.
  const secondDraft = await createSop(
    managerContext,
    {
      title: "Opening checklist walkthrough",
      description: "",
      category: "opening",
      locationId: seedIds.locations.downtown,
      stationId: null,
      estimatedMinutes: null,
      difficulty: "beginner",
      coverImageFileId: null,
      sourceVideoFileId: null,
      materials: [],
      warnings: [],
    },
    "verify-sop-second-draft",
  );

  const draftTabResults = await listSops(managerContext, {
    search: "",
    category: "",
    locationId: "",
    stationId: "",
    status: "draft",
    cursor: "",
    limit: 20,
  });
  if (!draftTabResults.items.some((row) => row.id === secondDraft.id)) {
    throw new Error("The draft tab did not include the second draft SOP");
  }
  if (draftTabResults.items.some((row) => row.id === sopDraft.id)) {
    throw new Error("The draft tab incorrectly included an archived SOP");
  }

  const archivedTabResults = await listSops(managerContext, {
    search: "",
    category: "",
    locationId: "",
    stationId: "",
    status: "archived",
    cursor: "",
    limit: 20,
  });
  if (!archivedTabResults.items.some((row) => row.id === sopDraft.id)) {
    throw new Error("The archived tab did not include the archived SOP");
  }

  const searchResults = await listSops(managerContext, {
    search: "Opening checklist",
    category: "",
    locationId: "",
    stationId: "",
    status: "",
    cursor: "",
    limit: 20,
  });
  if (searchResults.items.length !== 1 || searchResults.items[0]?.id !== secondDraft.id) {
    throw new Error("SOP search did not match by title");
  }

  const categoryResults = await listSops(managerContext, {
    search: "",
    category: "opening",
    locationId: "",
    stationId: "",
    status: "",
    cursor: "",
    limit: 20,
  });
  if (!categoryResults.items.every((row) => row.category === "opening")) {
    throw new Error("SOP category filter returned mismatched rows");
  }

  const pagedFirst = await listSops(managerContext, {
    search: "",
    category: "",
    locationId: seedIds.locations.downtown,
    stationId: "",
    status: "",
    cursor: "",
    limit: 1,
  });
  if (!pagedFirst.nextCursor) throw new Error("SOP pagination did not produce a next cursor");
  const pagedSecond = await listSops(managerContext, {
    search: "",
    category: "",
    locationId: seedIds.locations.downtown,
    stationId: "",
    status: "",
    cursor: pagedFirst.nextCursor,
    limit: 1,
  });
  if (pagedSecond.items[0]?.id === pagedFirst.items[0]?.id) {
    throw new Error("SOP pagination returned a duplicate row across pages");
  }

  const scopedRiversideResults = await listSops(scopedManagerContext, {
    search: "",
    category: "",
    locationId: "",
    stationId: "",
    status: "",
    cursor: "",
    limit: 20,
  });
  if (scopedRiversideResults.items.some((row) => row.locationId === seedIds.locations.riverside)) {
    throw new Error("A location-restricted manager saw SOPs outside their scope");
  }

  let crossOrgSopRejected = false;
  try {
    await getSop(managerContext, "70000000-0000-4000-8000-000000000099");
  } catch {
    crossOrgSopRejected = true;
  }
  if (!crossOrgSopRejected) throw new Error("A non-existent SOP id did not return not-found");

  // Incomplete media processing must block publication even after the initial upload succeeded.
  const incompleteMediaCover = await uploadTestImage(managerContext);
  const stalledDraft = await createSop(
    managerContext,
    {
      title: "Stalled media SOP",
      description: "",
      category: "safety",
      locationId: seedIds.locations.downtown,
      stationId: null,
      estimatedMinutes: null,
      difficulty: "beginner",
      coverImageFileId: incompleteMediaCover.id,
      sourceVideoFileId: null,
      materials: [],
      warnings: [],
    },
    "verify-sop-stalled-media",
  );
  await createStep(
    managerContext,
    stalledDraft.id,
    {
      title: "Only step",
      instruction: "Placeholder instruction.",
      imageFileId: null,
      videoFileId: null,
      warning: "",
      quantity: "",
      unit: "",
      equipmentSetting: "",
      timerSeconds: null,
      isRequired: true,
      expectedRevision: stalledDraft.version.revision,
    },
    "verify-sop-stalled-media-step",
  );
  await getDb()
    .update(filesTable)
    .set({ status: "processing" })
    .where(eq(filesTable.id, incompleteMediaCover.id));
  const stalledReadiness = await getPublishReadiness(managerContext, stalledDraft.id);
  if (
    stalledReadiness.canPublish ||
    !stalledReadiness.issues.some((issue) => issue.code === "media")
  ) {
    throw new Error("Publish readiness did not block on an incomplete media upload");
  }
  let stalledPublishRejected = false;
  try {
    await publishSop(
      managerContext,
      stalledDraft.id,
      {
        expectedRevision: stalledDraft.version.revision + 1,
        changeSummary: "",
        retrainingRule: { type: "none" },
      },
      "verify-publish-stalled-media",
    );
  } catch {
    stalledPublishRejected = true;
  }
  if (!stalledPublishRejected)
    throw new Error("Publish succeeded despite an incomplete media upload");

  const previewed = await previewSop(managerContext, secondDraft.id, "verify-sop-preview");
  if (previewed.id !== secondDraft.id) throw new Error("SOP preview did not return the SOP");

  // --- Phase 5: immutable versions, restoration, comparison, and retraining rules ---

  const versionedDraft = await createSop(
    managerContext,
    {
      title: "Fryer oil change",
      description: "Weekly fryer oil replacement",
      category: "cleaning",
      locationId: seedIds.locations.downtown,
      stationId: seedIds.stations.fry,
      estimatedMinutes: 20,
      difficulty: "intermediate",
      coverImageFileId: null,
      sourceVideoFileId: null,
      materials: [{ kind: "material", name: "Fresh oil", quantity: "5", unit: "gallon" }],
      warnings: [{ text: "Oil may be hot" }],
    },
    "verify-phase5-create",
  );
  const versionedStep = await createStep(
    managerContext,
    versionedDraft.id,
    {
      title: "Drain the fryer",
      instruction: "Drain and discard the used oil safely.",
      imageFileId: null,
      videoFileId: null,
      warning: "",
      quantity: "",
      unit: "",
      equipmentSetting: "",
      timerSeconds: null,
      isRequired: true,
      expectedRevision: versionedDraft.version.revision,
    },
    "verify-phase5-step-create",
  );

  let firstPublishRetrainingRejected = false;
  try {
    await publishSop(
      managerContext,
      versionedDraft.id,
      {
        expectedRevision: versionedStep.version.revision,
        changeSummary: "",
        retrainingRule: { type: "all_qualified" },
      },
      "verify-phase5-first-publish-retraining-rejected",
    );
  } catch {
    firstPublishRetrainingRejected = true;
  }
  if (!firstPublishRetrainingRejected) {
    throw new Error("A retraining rule was accepted on a first publish");
  }

  const versionOne = await publishSop(
    managerContext,
    versionedDraft.id,
    {
      expectedRevision: versionedStep.version.revision,
      changeSummary: "",
      retrainingRule: { type: "none" },
    },
    "verify-phase5-publish-v1",
  );
  if (
    versionOne.version.versionNumber !== 1 ||
    versionOne.currentVersionId !== versionOne.version.id
  ) {
    throw new Error("Publishing the first version did not set stable current-version resolution");
  }

  let editWithoutDraftRejected = false;
  try {
    await autosaveSopDraft(
      managerContext,
      versionedDraft.id,
      { title: "Should require a draft", expectedRevision: versionOne.version.revision },
      "verify-phase5-edit-without-draft",
    );
  } catch {
    editWithoutDraftRejected = true;
  }
  if (!editWithoutDraftRejected) {
    throw new Error("A published SOP was edited without starting a new draft");
  }

  let riversideDraftCreateRejected = false;
  try {
    await createDraftFromCurrentVersion(
      riversideManagerContext,
      versionedDraft.id,
      "verify-phase5-cross-location-draft",
    );
  } catch {
    riversideDraftCreateRejected = true;
  }
  if (!riversideDraftCreateRejected) {
    throw new Error("A location-restricted manager started a draft outside their scope");
  }

  const draftTwo = await createDraftFromCurrentVersion(
    managerContext,
    versionedDraft.id,
    "verify-phase5-create-draft",
  );
  if (
    draftTwo.version.versionNumber !== 2 ||
    draftTwo.version.status !== "draft" ||
    draftTwo.version.sourceVersionId !== versionOne.version.id ||
    draftTwo.steps.length !== 1 ||
    draftTwo.materials.length !== 1
  ) {
    throw new Error("Cloning a draft from the published version did not copy its content");
  }

  let secondDraftCreateRejected = false;
  try {
    await createDraftFromCurrentVersion(
      managerContext,
      versionedDraft.id,
      "verify-phase5-duplicate-draft",
    );
  } catch {
    secondDraftCreateRejected = true;
  }
  if (!secondDraftCreateRejected) {
    throw new Error("A second concurrent draft was allowed on the same SOP");
  }

  const stillCurrent = await getSop(managerContext, versionedDraft.id);
  if (stillCurrent.version.versionNumber !== 1 || stillCurrent.version.status !== "published") {
    throw new Error("Current-version resolution moved while a new draft was still in progress");
  }
  if (!(await hasDraftVersion(managerContext, versionedDraft.id))) {
    throw new Error("The in-progress draft was not detected");
  }

  const updatedDraft = await autosaveSopDraft(
    managerContext,
    versionedDraft.id,
    { title: "Fryer oil change (updated)", expectedRevision: draftTwo.version.revision },
    "verify-phase5-draft-autosave",
  );
  const draftWithSecondStep = await createStep(
    managerContext,
    versionedDraft.id,
    {
      title: "Replace and label the oil",
      instruction: "Fill with fresh oil and label the change date.",
      imageFileId: null,
      videoFileId: null,
      warning: "",
      quantity: "",
      unit: "",
      equipmentSetting: "",
      timerSeconds: null,
      isRequired: true,
      expectedRevision: updatedDraft.version.revision,
    },
    "verify-phase5-draft-step-create",
  );

  let publishUpdateWithoutSummaryRejected = false;
  try {
    await publishSop(
      managerContext,
      versionedDraft.id,
      {
        expectedRevision: draftWithSecondStep.version.revision,
        changeSummary: "",
        retrainingRule: { type: "none" },
      },
      "verify-phase5-publish-update-no-summary",
    );
  } catch {
    publishUpdateWithoutSummaryRejected = true;
  }
  if (!publishUpdateWithoutSummaryRejected) {
    throw new Error("Publishing an update without a change summary was accepted");
  }

  let scopedLocationRuleRejected = false;
  try {
    await publishSop(
      scopedManagerContext,
      versionedDraft.id,
      {
        expectedRevision: draftWithSecondStep.version.revision,
        changeSummary: "Added the oil replacement step",
        retrainingRule: {
          type: "selected_locations",
          locationIds: [seedIds.locations.riverside],
        },
      },
      "verify-phase5-publish-unauthorized-location-rule",
    );
  } catch {
    scopedLocationRuleRejected = true;
  }
  if (!scopedLocationRuleRejected) {
    throw new Error("A retraining rule targeting an unmanaged location was accepted");
  }

  const versionTwo = await publishSop(
    managerContext,
    versionedDraft.id,
    {
      expectedRevision: draftWithSecondStep.version.revision,
      changeSummary: "Added the oil replacement step",
      retrainingRule: { type: "selected_roles", jobRoles: ["Cook"] },
    },
    "verify-phase5-publish-v2",
  );
  if (
    versionTwo.version.versionNumber !== 2 ||
    versionTwo.currentVersionId !== versionTwo.version.id ||
    versionTwo.status !== "published"
  ) {
    throw new Error("Publishing the update did not move the current version forward");
  }

  const versionOneDetail = await getSopVersionDetail(
    managerContext,
    versionedDraft.id,
    versionOne.version.id,
  );
  if (versionOneDetail.version.title !== "Fryer oil change" || versionOneDetail.isCurrent) {
    throw new Error("Publishing an update mutated the immutable prior published version");
  }

  const versionTwoDetail = await getSopVersionDetail(
    managerContext,
    versionedDraft.id,
    versionTwo.version.id,
  );
  if (
    !versionTwoDetail.isCurrent ||
    !versionTwoDetail.retrainingRule ||
    versionTwoDetail.retrainingRule.ruleType !== "selected_roles" ||
    versionTwoDetail.retrainingRule.jobRoles[0] !== "Cook"
  ) {
    throw new Error("The retraining rule was not persisted against the newly published version");
  }

  const versionList = await listSopVersions(managerContext, versionedDraft.id);
  if (
    versionList.versions.length !== 2 ||
    versionList.currentVersionId !== versionTwo.version.id ||
    versionList.versions[0]?.versionNumber !== 2
  ) {
    throw new Error("Version history did not list both immutable versions in order");
  }

  const comparison = await compareSopVersions(
    managerContext,
    versionedDraft.id,
    versionOne.version.id,
    versionTwo.version.id,
  );
  if (!comparison.fieldDiffs.some((diff) => diff.field === "title")) {
    throw new Error("Version comparison did not detect the title change");
  }
  if (!comparison.stepDiffs.some((diff) => diff.status === "added")) {
    throw new Error("Version comparison did not detect the added step");
  }

  let riversideRestoreRejected = false;
  try {
    await restoreSopVersion(
      riversideManagerContext,
      versionedDraft.id,
      versionOne.version.id,
      "verify-phase5-cross-location-restore",
    );
  } catch {
    riversideRestoreRejected = true;
  }
  if (!riversideRestoreRejected) {
    throw new Error("A location-restricted manager restored a version outside their scope");
  }

  const restoredDraft = await restoreSopVersion(
    managerContext,
    versionedDraft.id,
    versionOne.version.id,
    "verify-phase5-restore",
  );
  if (
    restoredDraft.version.title !== "Fryer oil change" ||
    restoredDraft.version.versionNumber !== 3 ||
    restoredDraft.version.sourceVersionId !== versionOne.version.id ||
    restoredDraft.steps.length !== 1
  ) {
    throw new Error("Restoring a historical version did not clone its original content");
  }
  const draftViaGetSopDraft = await getSopDraft(managerContext, versionedDraft.id);
  if (draftViaGetSopDraft.version.id !== restoredDraft.version.id) {
    throw new Error("getSopDraft did not resolve the in-progress restored draft");
  }

  let restoreOverExistingDraftRejected = false;
  try {
    await restoreSopVersion(
      managerContext,
      versionedDraft.id,
      versionTwo.version.id,
      "verify-phase5-restore-duplicate",
    );
  } catch {
    restoreOverExistingDraftRejected = true;
  }
  if (!restoreOverExistingDraftRejected) {
    throw new Error("A restoration was allowed while a draft was already in progress");
  }

  await archiveSop(managerContext, versionedDraft.id, "verify-phase5-archive");
  let archivedDraftCreateRejected = false;
  try {
    await createDraftFromCurrentVersion(
      managerContext,
      versionedDraft.id,
      "verify-phase5-archived-draft-rejected",
    );
  } catch {
    archivedDraftCreateRejected = true;
  }
  if (!archivedDraftCreateRejected) {
    throw new Error("An archived SOP was allowed to start a new draft");
  }
  let archivedPublishRejected = false;
  try {
    await publishSop(
      managerContext,
      versionedDraft.id,
      {
        expectedRevision: restoredDraft.version.revision,
        changeSummary: "Should not publish",
        retrainingRule: { type: "none" },
      },
      "verify-phase5-archived-publish-rejected",
    );
  } catch {
    archivedPublishRejected = true;
  }
  if (!archivedPublishRejected) {
    throw new Error("Publishing a draft on an archived SOP was accepted");
  }

  // --- Phase 6: employee reader and QR indirection ---

  const riversideEmployeeLogin = await loginEmployee(
    {
      organizationSlug: "stationsnap-demo",
      locationSlug: "riverside",
      employeeNumber: employeeSeed[3].employeeNumber,
      pin: employeePin,
    },
    { ipHash: "verify-ip-employee-riverside", requestId: "verify-employee-riverside-login" },
  );
  const riversideEmployeeContext = await getEmployeeSession(riversideEmployeeLogin.token);
  if (
    !riversideEmployeeContext ||
    riversideEmployeeContext.locationId !== seedIds.locations.riverside
  ) {
    throw new Error("Riverside employee session verification failed");
  }

  const qrCover = await uploadTestImage(managerContext);
  const qrSopDraft = await createSop(
    managerContext,
    {
      title: "Grill safety briefing",
      description: "Daily safety checks before service.",
      category: "safety",
      locationId: seedIds.locations.downtown,
      stationId: seedIds.stations.grill,
      estimatedMinutes: 10,
      difficulty: "beginner",
      coverImageFileId: qrCover.id,
      sourceVideoFileId: null,
      materials: [],
      warnings: [],
    },
    "verify-phase6-sop-create",
  );
  const qrSopStep = await createStep(
    managerContext,
    qrSopDraft.id,
    {
      title: "Check the fire suppression system",
      instruction: "Confirm the hood suppression system is armed before service.",
      imageFileId: qrCover.id,
      videoFileId: null,
      warning: "",
      quantity: "",
      unit: "",
      equipmentSetting: "",
      timerSeconds: null,
      isRequired: true,
      expectedRevision: qrSopDraft.version.revision,
    },
    "verify-phase6-sop-step",
  );
  const qrSop = await publishSop(
    managerContext,
    qrSopDraft.id,
    {
      expectedRevision: qrSopStep.version.revision,
      changeSummary: "",
      retrainingRule: { type: "none" },
    },
    "verify-phase6-sop-publish",
  );

  // Employee reader: stations, category libraries, the SOP itself, media, and recent views.
  const employeeStations = await listStationsForEmployee(employeeContext);
  if (!employeeStations.some((station) => station.id === seedIds.stations.grill)) {
    throw new Error("Employee station listing did not include an active station at their location");
  }
  const employeeStation = await getStationForEmployee(employeeContext, seedIds.stations.grill);
  if (employeeStation.id !== seedIds.stations.grill) {
    throw new Error("Employee station detail did not resolve the requested station");
  }
  let riversideStationRejected = false;
  try {
    await getStationForEmployee(riversideEmployeeContext, seedIds.stations.grill);
  } catch {
    riversideStationRejected = true;
  }
  if (!riversideStationRejected) {
    throw new Error("An employee read a station outside their authorized location");
  }

  const employeeSopDetail = await getPublishedSopForEmployee(employeeContext, qrSop.id);
  if (
    employeeSopDetail.version.title !== "Grill safety briefing" ||
    employeeSopDetail.steps.length !== 1
  ) {
    throw new Error("Employee SOP reader did not return the published version content");
  }
  let riversideSopRejected = false;
  try {
    await getPublishedSopForEmployee(riversideEmployeeContext, qrSop.id);
  } catch {
    riversideSopRejected = true;
  }
  if (!riversideSopRejected) {
    throw new Error("An employee read an SOP outside their authorized location");
  }

  const safetyLibrary = await listPublishedSopsForEmployee(employeeContext, {
    search: "",
    category: "safety",
    stationId: "",
    cursor: "",
    limit: 20,
  });
  if (!safetyLibrary.items.some((item) => item.id === qrSop.id)) {
    throw new Error("Employee category library did not include the published SOP");
  }
  const riversideSafetyLibrary = await listPublishedSopsForEmployee(riversideEmployeeContext, {
    search: "",
    category: "safety",
    stationId: "",
    cursor: "",
    limit: 20,
  });
  if (riversideSafetyLibrary.items.some((item) => item.id === qrSop.id)) {
    throw new Error("An employee's category library leaked an SOP outside their location");
  }

  const recentAfterView = await listRecentSopsForEmployee(employeeContext);
  if (!recentAfterView.some((item) => item.id === qrSop.id)) {
    throw new Error("Viewing a published SOP did not record a recent view");
  }

  const employeeMedia = await getMediaFileForEmployee(employeeContext, qrCover.id);
  if (employeeMedia.buffer.byteLength === 0) {
    throw new Error("An employee could not read media referenced by an authorized SOP");
  }
  let riversideMediaRejected = false;
  try {
    await getMediaFileForEmployee(riversideEmployeeContext, qrCover.id);
  } catch {
    riversideMediaRejected = true;
  }
  if (!riversideMediaRejected) {
    throw new Error("An employee read media from an SOP outside their authorized location");
  }

  // QR indirection: creation, target validation, listing, revocation, and rotation.
  let qrUnpublishedTargetRejected = false;
  try {
    await createQrCode(
      managerContext,
      {
        locationId: seedIds.locations.downtown,
        targetType: "sop",
        targetId: secondDraft.id,
        label: "",
      },
      "verify-phase6-qr-unpublished-rejected",
    );
  } catch {
    qrUnpublishedTargetRejected = true;
  }
  if (!qrUnpublishedTargetRejected) {
    throw new Error("A QR code was created for a target that is not published");
  }

  let qrCrossLocationCreateRejected = false;
  try {
    await createQrCode(
      riversideManagerContext,
      {
        locationId: seedIds.locations.downtown,
        targetType: "station",
        targetId: seedIds.stations.grill,
        label: "",
      },
      "verify-phase6-qr-cross-location-rejected",
    );
  } catch {
    qrCrossLocationCreateRejected = true;
  }
  if (!qrCrossLocationCreateRejected) {
    throw new Error("A location-restricted manager created a QR code outside their scope");
  }

  const stationQr = await createQrCode(
    managerContext,
    {
      locationId: seedIds.locations.downtown,
      targetType: "station",
      targetId: seedIds.stations.grill,
      label: "Grill station poster",
    },
    "verify-phase6-qr-station-create",
  );
  const sopQr = await createQrCode(
    managerContext,
    { locationId: seedIds.locations.downtown, targetType: "sop", targetId: qrSop.id, label: "" },
    "verify-phase6-qr-sop-create",
  );
  const unavailableTargetQr = await createQrCode(
    managerContext,
    {
      locationId: seedIds.locations.riverside,
      targetType: "station",
      targetId: seedIds.stations.frontCounter,
      label: "",
    },
    "verify-phase6-qr-unavailable-target-create",
  );

  const qrList = await listQrCodes(managerContext, { locationId: "", status: "" });
  if (
    !qrList.some((row) => row.id === stationQr.id) ||
    !qrList.some((row) => row.id === sopQr.id) ||
    qrList.find((row) => row.id === stationQr.id)?.targetName !== "Grill"
  ) {
    throw new Error("QR listing did not return the created codes with their target names");
  }

  let riversideQrGetRejected = false;
  try {
    await getQrCode(riversideManagerContext, stationQr.id);
  } catch {
    riversideQrGetRejected = true;
  }
  if (!riversideQrGetRejected) {
    throw new Error("A location-restricted manager read a QR code outside their scope");
  }

  const stationResolution = await resolveQrCode(stationQr.token, { ipHash: "verify-ip-qr-scan" });
  if (
    stationResolution.status !== "resolved" ||
    stationResolution.destinationPath !== `/employee/stations/${seedIds.stations.grill}`
  ) {
    throw new Error("Resolving a valid station QR code did not return its destination");
  }
  const sopResolution = await resolveQrCode(sopQr.token, { ipHash: "verify-ip-qr-scan" });
  if (
    sopResolution.status !== "resolved" ||
    sopResolution.destinationPath !== `/employee/sops/${qrSop.id}`
  ) {
    throw new Error("Resolving a valid SOP QR code did not return its destination");
  }

  await revokeQrCode(managerContext, stationQr.id, "verify-phase6-qr-revoke");
  const revokedResolution = await resolveQrCode(stationQr.token, { ipHash: "verify-ip-qr-scan" });
  if (revokedResolution.status !== "revoked") {
    throw new Error("Resolving a revoked QR code did not report it as revoked");
  }
  let doubleRevokeRejected = false;
  try {
    await revokeQrCode(managerContext, stationQr.id, "verify-phase6-qr-double-revoke");
  } catch {
    doubleRevokeRejected = true;
  }
  if (!doubleRevokeRejected) throw new Error("An already-revoked QR code was revoked again");
  let revokedRotateRejected = false;
  try {
    await rotateQrCode(managerContext, stationQr.id, "verify-phase6-qr-revoked-rotate");
  } catch {
    revokedRotateRejected = true;
  }
  if (!revokedRotateRejected)
    throw new Error("A revoked QR code was allowed to reissue a new token");

  const rotated = await rotateQrCode(managerContext, sopQr.id, "verify-phase6-qr-rotate");
  const oldTokenResolution = await resolveQrCode(sopQr.token, { ipHash: "verify-ip-qr-scan" });
  if (oldTokenResolution.status !== "invalid") {
    throw new Error("Rotating a QR code did not invalidate its previous token");
  }
  const newTokenResolution = await resolveQrCode(rotated.token, { ipHash: "verify-ip-qr-scan" });
  if (newTokenResolution.status !== "resolved") {
    throw new Error("A newly rotated QR token did not resolve");
  }

  await updateStation(
    managerContext,
    seedIds.stations.frontCounter,
    {
      locationId: seedIds.locations.riverside,
      name: "Front Counter",
      description: "",
      imageUrl: null,
      displayOrder: 2,
      status: "disabled",
    },
    "verify-phase6-station-disable",
  );
  const unavailableResolution = await resolveQrCode(unavailableTargetQr.token, {
    ipHash: "verify-ip-qr-scan",
  });
  if (unavailableResolution.status !== "unavailable") {
    throw new Error("Resolving a QR code whose target became unavailable did not report it");
  }

  const invalidRateKey = "verify-ip-qr-invalid";
  for (let index = 0; index < 5; index += 1) {
    const result = await resolveQrCode("not-a-real-token", { ipHash: invalidRateKey });
    if (result.status !== "invalid")
      throw new Error("An unknown QR token did not resolve as invalid");
  }
  const invalidScanCountBeforeLockout = (
    await getDb()
      .select({ id: qrScanEvents.id })
      .from(qrScanEvents)
      .where(eq(qrScanEvents.tokenHash, hashToken("not-a-real-token")))
  ).length;
  const lockedResolution = await resolveQrCode("not-a-real-token", { ipHash: invalidRateKey });
  if (lockedResolution.status !== "invalid") {
    throw new Error("A rate-limited invalid QR scan did not resolve as invalid");
  }
  const invalidScanCountAfterLockout = (
    await getDb()
      .select({ id: qrScanEvents.id })
      .from(qrScanEvents)
      .where(eq(qrScanEvents.tokenHash, hashToken("not-a-real-token")))
  ).length;
  if (invalidScanCountAfterLockout !== invalidScanCountBeforeLockout) {
    throw new Error("QR token enumeration was not rate limited");
  }

  // --- Phase 7: training configuration and questions ---

  const trainingVideo = await uploadTestVideo(managerContext);
  if (trainingVideo.status !== "ready") throw new Error("Video upload did not mark the file ready");

  const trainingDraft = await createSop(
    managerContext,
    {
      title: "Fryer safety training",
      description: "Fryer startup and safe operation",
      category: "safety",
      locationId: seedIds.locations.downtown,
      stationId: seedIds.stations.fry,
      estimatedMinutes: 10,
      difficulty: "beginner",
      coverImageFileId: null,
      sourceVideoFileId: null,
      materials: [],
      warnings: [],
    },
    "verify-phase7-sop-create",
  );
  const trainingStepA = await createStep(
    managerContext,
    trainingDraft.id,
    {
      title: "Watch the safety briefing",
      instruction: "Watch the full safety briefing video before proceeding.",
      imageFileId: null,
      videoFileId: trainingVideo.id,
      warning: "",
      quantity: "",
      unit: "",
      equipmentSetting: "",
      timerSeconds: 45,
      isRequired: true,
      expectedRevision: trainingDraft.version.revision,
    },
    "verify-phase7-step-a-create",
  );
  const trainingStepB = await createStep(
    managerContext,
    trainingDraft.id,
    {
      title: "Confirm the fryer is off",
      instruction: "Confirm the fryer switch is in the off position.",
      imageFileId: null,
      videoFileId: null,
      warning: "",
      quantity: "",
      unit: "",
      equipmentSetting: "",
      timerSeconds: null,
      isRequired: true,
      expectedRevision: trainingStepA.version.revision,
    },
    "verify-phase7-step-b-create",
  );
  const trainingStepAId = trainingStepB.steps.find(
    (step) => step.title === "Watch the safety briefing",
  )!.id;
  const trainingStepBId = trainingStepB.steps.find(
    (step) => step.title === "Confirm the fryer is off",
  )!.id;

  const defaultConfig = await getTrainingConfigDraft(managerContext, trainingDraft.id);
  if (
    defaultConfig.config.requirementState !== "disabled" ||
    defaultConfig.config.defaultMode !== "learn" ||
    defaultConfig.config.passingScorePercent !== 80 ||
    defaultConfig.config.maxAttempts !== 3
  ) {
    throw new Error("A training config without a saved row did not default correctly");
  }

  let scopedTrainingConfigRejected = false;
  try {
    await updateTrainingConfig(
      riversideManagerContext,
      trainingDraft.id,
      {
        requirementState: "required",
        defaultMode: "test",
        allowBacktracking: true,
        requireSequentialProgress: true,
        requireFullVideoWatch: true,
        requireEvidenceApproval: true,
        passingScorePercent: 80,
        maxAttempts: 3,
        qualificationValidityDays: null,
        retrainingGraceDays: null,
        expectedRevision: defaultConfig.revision,
      },
      "verify-phase7-config-cross-location-rejected",
    );
  } catch {
    scopedTrainingConfigRejected = true;
  }
  if (!scopedTrainingConfigRejected) {
    throw new Error("A location-restricted manager updated training configuration out of scope");
  }

  const savedConfig = await updateTrainingConfig(
    managerContext,
    trainingDraft.id,
    {
      requirementState: "required",
      defaultMode: "test",
      allowBacktracking: false,
      requireSequentialProgress: true,
      requireFullVideoWatch: true,
      requireEvidenceApproval: true,
      passingScorePercent: 90,
      maxAttempts: 2,
      qualificationValidityDays: 365,
      retrainingGraceDays: 14,
      expectedRevision: defaultConfig.revision,
    },
    "verify-phase7-config-save",
  );
  if (
    savedConfig.config.requirementState !== "required" ||
    savedConfig.config.defaultMode !== "test" ||
    savedConfig.config.passingScorePercent !== 90 ||
    savedConfig.config.qualificationValidityDays !== 365 ||
    savedConfig.revision !== defaultConfig.revision + 1
  ) {
    throw new Error("Saving the training configuration did not persist the new values");
  }

  let staleConfigRejected = false;
  try {
    await updateTrainingConfig(
      managerContext,
      trainingDraft.id,
      {
        requirementState: "optional",
        defaultMode: "learn",
        allowBacktracking: true,
        requireSequentialProgress: true,
        requireFullVideoWatch: false,
        requireEvidenceApproval: false,
        passingScorePercent: 80,
        maxAttempts: 3,
        qualificationValidityDays: null,
        retrainingGraceDays: null,
        expectedRevision: defaultConfig.revision,
      },
      "verify-phase7-config-stale-rejected",
    );
  } catch {
    staleConfigRejected = true;
  }
  if (!staleConfigRejected) {
    throw new Error("A stale training configuration write was accepted");
  }

  const defaultRequirements = await getStepTrainingRequirementsDraft(
    managerContext,
    trainingDraft.id,
  );
  if (
    Object.keys(defaultRequirements.requirementsByStepId).length !== 2 ||
    defaultRequirements.requirementsByStepId[trainingStepAId]?.requireFullVideo !== false
  ) {
    throw new Error("Step training requirements did not default for every step");
  }

  let timerWithoutStepTimerRejected = false;
  try {
    await updateStepTrainingRequirements(
      managerContext,
      trainingDraft.id,
      trainingStepBId,
      {
        requireFullVideo: false,
        requireConfirmation: false,
        requireTimer: true,
        requireQuestion: false,
        requirePhoto: false,
        requireVideo: false,
        requireApproval: false,
        expectedRevision: savedConfig.revision,
      },
      "verify-phase7-step-timer-guard",
    );
  } catch {
    timerWithoutStepTimerRejected = true;
  }
  if (!timerWithoutStepTimerRejected) {
    throw new Error("A timer requirement was accepted on a step without a timer");
  }

  let videoWithoutStepVideoRejected = false;
  try {
    await updateStepTrainingRequirements(
      managerContext,
      trainingDraft.id,
      trainingStepBId,
      {
        requireFullVideo: true,
        requireConfirmation: false,
        requireTimer: false,
        requireQuestion: false,
        requirePhoto: false,
        requireVideo: false,
        requireApproval: false,
        expectedRevision: savedConfig.revision,
      },
      "verify-phase7-video-guard",
    );
  } catch {
    videoWithoutStepVideoRejected = true;
  }
  if (!videoWithoutStepVideoRejected) {
    throw new Error("A full-video requirement was accepted on a step without a video");
  }

  const stepARequirements = await updateStepTrainingRequirements(
    managerContext,
    trainingDraft.id,
    trainingStepAId,
    {
      requireFullVideo: true,
      requireConfirmation: false,
      requireTimer: true,
      requireQuestion: true,
      requirePhoto: false,
      requireVideo: false,
      requireApproval: false,
      expectedRevision: savedConfig.revision,
    },
    "verify-phase7-step-a-requirements",
  );
  if (
    !stepARequirements.requirementsByStepId[trainingStepAId]?.requireFullVideo ||
    !stepARequirements.requirementsByStepId[trainingStepAId]?.requireTimer
  ) {
    throw new Error("Step A training requirements were not saved");
  }

  const stepBQuestionRequired = await updateStepTrainingRequirements(
    managerContext,
    trainingDraft.id,
    trainingStepBId,
    {
      requireFullVideo: false,
      requireConfirmation: true,
      requireTimer: false,
      requireQuestion: true,
      requirePhoto: false,
      requireVideo: false,
      requireApproval: false,
      expectedRevision: stepARequirements.revision,
    },
    "verify-phase7-step-b-requirements",
  );

  let publishMissingStepQuestionRejected = false;
  try {
    await publishSop(
      managerContext,
      trainingDraft.id,
      {
        expectedRevision: stepBQuestionRequired.revision,
        changeSummary: "",
        retrainingRule: { type: "none" },
      },
      "verify-phase7-publish-missing-step-question",
    );
  } catch {
    publishMissingStepQuestionRejected = true;
  }
  if (!publishMissingStepQuestionRejected) {
    throw new Error("Publishing was accepted with a question-required step that has no question");
  }
  const missingQuestionReadiness = await getPublishReadiness(managerContext, trainingDraft.id);
  if (
    !missingQuestionReadiness.issues.some((issue) => issue.code === "step_question_requirement")
  ) {
    throw new Error("Publish readiness did not flag the missing step question");
  }

  const stepAQuestion = await createTrainingQuestion(
    managerContext,
    trainingDraft.id,
    {
      stepId: trainingStepAId,
      type: "single_choice",
      text: "What must be watched before starting?",
      explanation: "The safety briefing covers hazard awareness.",
      points: 2,
      placement: "after_step",
      explanationPolicy: "on_incorrect",
      choices: [
        { text: "The safety briefing", isCorrect: true },
        { text: "The delivery truck", isCorrect: false },
      ],
      expectedRevision: stepBQuestionRequired.revision,
    },
    "verify-phase7-question-step-a-create",
  );
  const stepAQuestionId = stepAQuestion.questions.find(
    (question) => question.stepId === trainingStepAId,
  )!.id;

  let crossStepQuestionRejected = false;
  try {
    await createTrainingQuestion(
      riversideManagerContext,
      trainingDraft.id,
      {
        stepId: trainingStepAId,
        type: "true_false",
        text: "Should never happen",
        explanation: "",
        points: 1,
        placement: "after_step",
        explanationPolicy: "never",
        choices: [
          { text: "True", isCorrect: true },
          { text: "False", isCorrect: false },
        ],
        expectedRevision: stepAQuestion.revision,
      },
      "verify-phase7-question-cross-location-rejected",
    );
  } catch {
    crossStepQuestionRejected = true;
  }
  if (!crossStepQuestionRejected) {
    throw new Error("A location-restricted manager created a training question out of scope");
  }

  let questionForOtherSopStepRejected = false;
  try {
    await createTrainingQuestion(
      managerContext,
      trainingDraft.id,
      {
        stepId: qrSopStep.steps[0]!.id,
        type: "true_false",
        text: "Attached to a foreign step",
        explanation: "",
        points: 1,
        placement: "after_step",
        explanationPolicy: "never",
        choices: [
          { text: "True", isCorrect: true },
          { text: "False", isCorrect: false },
        ],
        expectedRevision: stepAQuestion.revision,
      },
      "verify-phase7-question-foreign-step-rejected",
    );
  } catch {
    questionForOtherSopStepRejected = true;
  }
  if (!questionForOtherSopStepRejected) {
    throw new Error("A question was attached to a step from a different SOP draft");
  }

  const stepBQuestion = await createTrainingQuestion(
    managerContext,
    trainingDraft.id,
    {
      stepId: trainingStepBId,
      type: "true_false",
      text: "The fryer switch must be off before servicing.",
      explanation: "",
      points: 1,
      placement: "after_step",
      explanationPolicy: "always",
      choices: [
        { text: "True", isCorrect: true },
        { text: "False", isCorrect: false },
      ],
      expectedRevision: stepAQuestion.revision,
    },
    "verify-phase7-question-step-b-create",
  );

  const finalQuestionOne = await createTrainingQuestion(
    managerContext,
    trainingDraft.id,
    {
      stepId: null,
      type: "multiple_choice",
      text: "Which of these are fryer hazards?",
      explanation: "",
      points: 1,
      placement: "final",
      explanationPolicy: "on_incorrect",
      choices: [
        { text: "Hot oil", isCorrect: true },
        { text: "Sharp edges", isCorrect: true },
        { text: "Cold storage", isCorrect: false },
      ],
      expectedRevision: stepBQuestion.revision,
    },
    "verify-phase7-question-final-one-create",
  );
  const finalQuestionTwo = await createTrainingQuestion(
    managerContext,
    trainingDraft.id,
    {
      stepId: null,
      type: "true_false",
      text: "Training must be repeated after a fryer incident.",
      explanation: "",
      points: 1,
      placement: "final",
      explanationPolicy: "on_incorrect",
      choices: [
        { text: "True", isCorrect: true },
        { text: "False", isCorrect: false },
      ],
      expectedRevision: finalQuestionOne.revision,
    },
    "verify-phase7-question-final-two-create",
  );
  const finalQuestionOneId = finalQuestionOne.questions.find(
    (question) => question.text === "Which of these are fryer hazards?",
  )!.id;
  const finalQuestionTwoId = finalQuestionTwo.questions.find(
    (question) => question.text === "Training must be repeated after a fryer incident.",
  )!.id;
  const finalOrderBeforeReorder = finalQuestionTwo.questions
    .filter((question) => !question.stepId)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((question) => question.id);
  if (finalOrderBeforeReorder[0] !== finalQuestionOneId) {
    throw new Error("Final questions were not appended in creation order");
  }

  let invalidReorderRejected = false;
  try {
    await reorderTrainingQuestions(
      managerContext,
      trainingDraft.id,
      null,
      [finalQuestionOneId],
      finalQuestionTwo.revision,
      "verify-phase7-reorder-invalid",
    );
  } catch {
    invalidReorderRejected = true;
  }
  if (!invalidReorderRejected) {
    throw new Error("Reordering with a missing question id was accepted");
  }

  const trainingReordered = await reorderTrainingQuestions(
    managerContext,
    trainingDraft.id,
    null,
    [finalQuestionTwoId, finalQuestionOneId],
    finalQuestionTwo.revision,
    "verify-phase7-reorder-final",
  );
  const reorderedFinal = trainingReordered.questions
    .filter((question) => !question.stepId)
    .sort((a, b) => a.displayOrder - b.displayOrder);
  if (
    reorderedFinal[0]?.id !== finalQuestionTwoId ||
    reorderedFinal[1]?.id !== finalQuestionOneId
  ) {
    throw new Error("Reordering final questions did not persist the new order");
  }

  const fetchedQuestion = await getTrainingQuestion(
    managerContext,
    trainingDraft.id,
    stepAQuestionId,
  );
  if (fetchedQuestion.choices.filter((choice) => choice.isCorrect).length !== 1) {
    throw new Error("Fetching a single question did not return exactly one correct choice");
  }

  const updatedQuestion = await updateTrainingQuestion(
    managerContext,
    trainingDraft.id,
    stepAQuestionId,
    {
      stepId: trainingStepAId,
      type: "single_choice",
      text: "What must be watched before starting the fryer?",
      explanation: "The safety briefing covers hazard awareness.",
      points: 3,
      placement: "after_step",
      explanationPolicy: "always",
      choices: [
        { text: "The safety briefing", isCorrect: false },
        { text: "The delivery truck", isCorrect: true },
      ],
      expectedRevision: trainingReordered.revision,
    },
    "verify-phase7-question-update",
  );
  const updatedStepAQuestion = updatedQuestion.questions.find(
    (question) => question.id === stepAQuestionId,
  )!;
  if (
    updatedStepAQuestion.points !== 3 ||
    updatedStepAQuestion.choices.find((choice) => choice.text === "The delivery truck")
      ?.isCorrect !== true
  ) {
    throw new Error("Updating a question did not replace its text, points, and choices");
  }

  const beforeDelete = updatedQuestion.questions.filter((question) => !question.stepId).length;
  const trainingAfterDelete = await deleteTrainingQuestion(
    managerContext,
    trainingDraft.id,
    finalQuestionOneId,
    updatedQuestion.revision,
    "verify-phase7-question-delete",
  );
  const remainingFinal = trainingAfterDelete.questions.filter((question) => !question.stepId);
  if (
    remainingFinal.length !== beforeDelete - 1 ||
    remainingFinal.some((question, index) => question.displayOrder !== index + 1)
  ) {
    throw new Error("Deleting a question did not resequence the remaining questions");
  }

  const readyReadiness = await getPublishReadiness(managerContext, trainingDraft.id);
  if (!readyReadiness.canPublish) {
    throw new Error(
      `A fully-configured training draft unexpectedly failed publish readiness: ${JSON.stringify(readyReadiness.issues)}`,
    );
  }

  const publishedTraining = await publishSop(
    managerContext,
    trainingDraft.id,
    {
      expectedRevision: trainingAfterDelete.revision,
      changeSummary: "",
      retrainingRule: { type: "none" },
    },
    "verify-phase7-publish",
  );
  if (publishedTraining.status !== "published") {
    throw new Error("Publishing the training-configured draft did not succeed");
  }

  let configEditAfterPublishRejected = false;
  try {
    await updateTrainingConfig(
      managerContext,
      trainingDraft.id,
      {
        requirementState: "disabled",
        defaultMode: "learn",
        allowBacktracking: true,
        requireSequentialProgress: true,
        requireFullVideoWatch: false,
        requireEvidenceApproval: false,
        passingScorePercent: 80,
        maxAttempts: 3,
        qualificationValidityDays: null,
        retrainingGraceDays: null,
        expectedRevision: trainingAfterDelete.revision,
      },
      "verify-phase7-config-edit-after-publish-rejected",
    );
  } catch {
    configEditAfterPublishRejected = true;
  }
  if (!configEditAfterPublishRejected) {
    throw new Error("A published SOP's training configuration was edited without a new draft");
  }

  const trainingCloneDraft = await createDraftFromCurrentVersion(
    managerContext,
    trainingDraft.id,
    "verify-phase7-clone-draft",
  );
  const clonedConfig = await getTrainingConfigDraft(managerContext, trainingDraft.id);
  if (
    clonedConfig.config.requirementState !== "required" ||
    clonedConfig.config.defaultMode !== "test" ||
    clonedConfig.config.passingScorePercent !== 90 ||
    clonedConfig.config.qualificationValidityDays !== 365
  ) {
    throw new Error("Cloning a draft did not carry over the training configuration");
  }
  const clonedStepAId = trainingCloneDraft.steps.find(
    (step) => step.title === "Watch the safety briefing",
  )!.id;
  const clonedStepBId = trainingCloneDraft.steps.find(
    (step) => step.title === "Confirm the fryer is off",
  )!.id;
  const clonedRequirements = await getStepTrainingRequirementsDraft(
    managerContext,
    trainingDraft.id,
  );
  if (
    !clonedRequirements.requirementsByStepId[clonedStepAId]?.requireFullVideo ||
    !clonedRequirements.requirementsByStepId[clonedStepBId]?.requireQuestion
  ) {
    throw new Error("Cloning a draft did not carry over the step training requirements");
  }
  const clonedQuestions = await getTrainingQuestionsDraft(managerContext, trainingDraft.id);
  if (clonedQuestions.questions.length !== updatedQuestion.questions.length - 1) {
    throw new Error("Cloning a draft did not carry over every training question");
  }
  const clonedStepAQuestion = clonedQuestions.questions.find(
    (question) => question.stepId === clonedStepAId,
  );
  if (
    !clonedStepAQuestion ||
    clonedStepAQuestion.text !== "What must be watched before starting the fryer?" ||
    clonedStepAQuestion.choices.length !== 2 ||
    !clonedStepAQuestion.choices.some(
      (choice) => choice.text === "The delivery truck" && choice.isCorrect,
    )
  ) {
    throw new Error("Cloning a draft did not carry over question choices and correctness");
  }

  // --- Phase 8: training session state machine, evidence, attempts, grading, and resume ---

  const engineDraft = await createSop(
    managerContext,
    {
      title: "Grill startup checklist training",
      description: "Startup safety training for the grill station",
      category: "safety",
      locationId: seedIds.locations.downtown,
      stationId: seedIds.stations.grill,
      estimatedMinutes: 5,
      difficulty: "beginner",
      coverImageFileId: null,
      sourceVideoFileId: null,
      materials: [],
      warnings: [],
    },
    "verify-phase8-sop-create",
  );
  const engineVideo = await uploadTestVideo(managerContext);
  const engineStepOneDraft = await createStep(
    managerContext,
    engineDraft.id,
    {
      title: "Watch the startup video",
      instruction: "Watch the full grill startup video.",
      imageFileId: null,
      videoFileId: engineVideo.id,
      warning: "",
      quantity: "",
      unit: "",
      equipmentSetting: "",
      timerSeconds: 5,
      isRequired: true,
      expectedRevision: engineDraft.version.revision,
    },
    "verify-phase8-step-one-create",
  );
  const engineStepTwoDraft = await createStep(
    managerContext,
    engineDraft.id,
    {
      title: "Confirm the grill is preheated",
      instruction: "Confirm the grill has reached temperature and photograph the display.",
      imageFileId: null,
      videoFileId: null,
      warning: "",
      quantity: "",
      unit: "",
      equipmentSetting: "",
      timerSeconds: null,
      isRequired: true,
      expectedRevision: engineStepOneDraft.version.revision,
    },
    "verify-phase8-step-two-create",
  );
  const engineStepOneId = engineStepTwoDraft.steps.find(
    (step) => step.title === "Watch the startup video",
  )!.id;
  const engineStepTwoId = engineStepTwoDraft.steps.find(
    (step) => step.title === "Confirm the grill is preheated",
  )!.id;

  const engineConfig = await updateTrainingConfig(
    managerContext,
    engineDraft.id,
    {
      requirementState: "required",
      defaultMode: "guided",
      allowBacktracking: true,
      requireSequentialProgress: true,
      requireFullVideoWatch: true,
      requireEvidenceApproval: true,
      passingScorePercent: 70,
      maxAttempts: 2,
      qualificationValidityDays: null,
      retrainingGraceDays: null,
      expectedRevision: engineStepTwoDraft.version.revision,
    },
    "verify-phase8-config-save",
  );
  const engineStepOneRequirements = await updateStepTrainingRequirements(
    managerContext,
    engineDraft.id,
    engineStepOneId,
    {
      requireFullVideo: true,
      requireConfirmation: false,
      requireTimer: true,
      requireQuestion: true,
      requirePhoto: false,
      requireVideo: false,
      requireApproval: false,
      expectedRevision: engineConfig.revision,
    },
    "verify-phase8-step-one-requirements",
  );
  const engineStepTwoRequirements = await updateStepTrainingRequirements(
    managerContext,
    engineDraft.id,
    engineStepTwoId,
    {
      requireFullVideo: false,
      requireConfirmation: true,
      requireTimer: false,
      requireQuestion: false,
      requirePhoto: true,
      requireVideo: false,
      requireApproval: true,
      expectedRevision: engineStepOneRequirements.revision,
    },
    "verify-phase8-step-two-requirements",
  );
  const engineStepOneQuestion = await createTrainingQuestion(
    managerContext,
    engineDraft.id,
    {
      stepId: engineStepOneId,
      type: "single_choice",
      text: "What should you do before starting the grill?",
      explanation: "Always watch the safety video first.",
      points: 2,
      placement: "after_step",
      explanationPolicy: "always",
      choices: [
        { text: "Watch the safety video", isCorrect: true },
        { text: "Turn on the fryer", isCorrect: false },
      ],
      expectedRevision: engineStepTwoRequirements.revision,
    },
    "verify-phase8-question-step-one-create",
  );
  const engineStepOneQuestionId = engineStepOneQuestion.questions.find(
    (question) => question.stepId === engineStepOneId,
  )!.id;
  const engineStepOneCorrectChoiceId = engineStepOneQuestion.questions
    .find((question) => question.stepId === engineStepOneId)!
    .choices.find((choice) => choice.isCorrect)!.id;
  const engineFinalQuestion = await createTrainingQuestion(
    managerContext,
    engineDraft.id,
    {
      stepId: null,
      type: "true_false",
      text: "The grill must reach temperature before cooking.",
      explanation: "",
      points: 1,
      placement: "final",
      explanationPolicy: "on_incorrect",
      choices: [
        { text: "True", isCorrect: true },
        { text: "False", isCorrect: false },
      ],
      expectedRevision: engineStepOneQuestion.revision,
    },
    "verify-phase8-question-final-create",
  );
  const engineFinalQuestionId = engineFinalQuestion.questions.find(
    (question) => question.placement === "final",
  )!.id;
  const engineFinalCorrectChoiceId = engineFinalQuestion.questions
    .find((question) => question.id === engineFinalQuestionId)!
    .choices.find((choice) => choice.isCorrect)!.id;

  const enginePublished = await publishSop(
    managerContext,
    engineDraft.id,
    {
      expectedRevision: engineFinalQuestion.revision,
      changeSummary: "",
      retrainingRule: { type: "none" },
    },
    "verify-phase8-publish",
  );
  if (enginePublished.status !== "published") {
    throw new Error("Publishing the Phase 8 training fixture did not succeed");
  }

  const crossLocationAssignResult = await assignTraining(
    managerContext,
    {
      sopId: engineDraft.id,
      target: { type: "employees", employeeIds: [employeeSeed[3].id] },
    },
    "verify-phase9-assign-cross-location-skipped",
  );
  if (
    crossLocationAssignResult.created.length !== 0 ||
    crossLocationAssignResult.skipped.length !== 1 ||
    crossLocationAssignResult.skipped[0]?.reason !== "location_mismatch"
  ) {
    throw new Error(
      "An employee outside the SOP's location was not independently skipped with a location_mismatch reason",
    );
  }

  const engineAssignmentResult = await assignTraining(
    managerContext,
    {
      sopId: engineDraft.id,
      target: { type: "employees", employeeIds: [employeeSeed[0].id] },
    },
    "verify-phase8-assign-create",
  );
  const engineAssignment = engineAssignmentResult.created[0];
  if (
    !engineAssignment ||
    engineAssignmentResult.created.length !== 1 ||
    engineAssignment.status !== "assigned" ||
    engineAssignment.requiredMode !== "guided"
  ) {
    throw new Error("Assignment creation did not persist the expected defaults");
  }

  const duplicateActiveAssignResult = await assignTraining(
    managerContext,
    {
      sopId: engineDraft.id,
      target: { type: "employees", employeeIds: [employeeSeed[0].id] },
    },
    "verify-phase9-assign-duplicate-skipped",
  );
  if (
    duplicateActiveAssignResult.created.length !== 0 ||
    duplicateActiveAssignResult.skipped.length !== 1 ||
    duplicateActiveAssignResult.skipped[0]?.reason !== "duplicate_active"
  ) {
    throw new Error("A duplicate active assignment was not independently skipped");
  }

  let foreignAssignmentRejected = false;
  try {
    await getAssignmentDetail(riversideEmployeeContext, engineAssignment.id);
  } catch {
    foreignAssignmentRejected = true;
  }
  if (!foreignAssignmentRejected) {
    throw new Error("An employee accessed another employee's training assignment");
  }

  const assignmentDetail = await getAssignmentDetail(employeeContext, engineAssignment.id);
  if (assignmentDetail.maxAttempts !== 2 || assignmentDetail.attemptsUsed !== 0) {
    throw new Error("Assignment detail did not reflect the training configuration");
  }

  const startedSession = await startOrResumeSession(
    employeeContext,
    engineAssignment.id,
    "verify-phase8-session-start",
  );
  const resumedSession = await startOrResumeSession(
    employeeContext,
    engineAssignment.id,
    "verify-phase8-session-resume",
  );
  if (resumedSession.id !== startedSession.id) {
    throw new Error("Resuming an in-progress assignment created a second session");
  }

  const initialState = await getSessionState(
    employeeContext,
    engineAssignment.id,
    startedSession.id,
  );
  if (initialState.currentStepId !== engineStepOneId || initialState.status !== "in_progress") {
    throw new Error("A freshly started session did not resolve the first required step");
  }

  let prematureSubmitRejected = false;
  try {
    await submitSession(
      employeeContext,
      engineAssignment.id,
      startedSession.id,
      initialState.revision,
      "verify-phase8-submit-premature-rejected",
    );
  } catch {
    prematureSubmitRejected = true;
  }
  if (!prematureSubmitRejected) {
    throw new Error("Submitting before required steps were complete was accepted");
  }

  let skippedStepRejected = false;
  try {
    await recordStepAction(
      employeeContext,
      engineAssignment.id,
      startedSession.id,
      engineStepTwoId,
      "confirmed",
      initialState.revision,
      "verify-phase8-skip-step-rejected",
    );
  } catch {
    skippedStepRejected = true;
  }
  if (!skippedStepRejected) {
    throw new Error("A later step was completed before the current required step");
  }

  const afterVideoWatch = await recordStepAction(
    employeeContext,
    engineAssignment.id,
    startedSession.id,
    engineStepOneId,
    "video_watched",
    initialState.revision,
    "verify-phase8-video-watched",
  );
  if (
    !afterVideoWatch.steps.find((step) => step.id === engineStepOneId)!.progress.videoWatchedFully
  ) {
    throw new Error("Marking a video watched did not persist");
  }

  let duplicateVideoActionRejected = false;
  try {
    await recordStepAction(
      employeeContext,
      engineAssignment.id,
      startedSession.id,
      engineStepOneId,
      "video_watched",
      initialState.revision,
      "verify-phase8-duplicate-action-rejected",
    );
  } catch {
    duplicateVideoActionRejected = true;
  }
  if (!duplicateVideoActionRejected) {
    throw new Error("Repeating a step action with a stale revision was accepted");
  }

  const afterTimer = await recordStepAction(
    employeeContext,
    engineAssignment.id,
    startedSession.id,
    engineStepOneId,
    "timer_completed",
    afterVideoWatch.revision,
    "verify-phase8-timer-completed",
  );
  const afterQuestion = await submitAnswer(
    employeeContext,
    engineAssignment.id,
    startedSession.id,
    engineStepOneQuestionId,
    [engineStepOneCorrectChoiceId],
    afterTimer.revision,
    "verify-phase8-answer-step-one",
  );
  if (
    afterQuestion.steps.find((step) => step.id === engineStepOneId)!.progress.status !== "completed"
  ) {
    throw new Error(
      "Step one did not complete once its video, timer, and question requirements were met",
    );
  }
  if (afterQuestion.currentStepId !== engineStepTwoId) {
    throw new Error("The authoritative current step did not advance to the next required step");
  }

  let videoOnStepWithoutVideoRejected = false;
  try {
    await recordStepAction(
      employeeContext,
      engineAssignment.id,
      startedSession.id,
      engineStepTwoId,
      "video_watched",
      afterQuestion.revision,
      "verify-phase8-video-without-video-rejected",
    );
  } catch {
    videoOnStepWithoutVideoRejected = true;
  }
  if (!videoOnStepWithoutVideoRejected) {
    throw new Error("Marking a video watched was accepted for a step with no video");
  }

  const afterConfirm = await recordStepAction(
    employeeContext,
    engineAssignment.id,
    startedSession.id,
    engineStepTwoId,
    "confirmed",
    afterQuestion.revision,
    "verify-phase8-confirm-step-two",
  );

  let evidenceOnWrongTypeRejected = false;
  try {
    const wrongTypeForm = new FormData();
    wrongTypeForm.set(
      "file",
      new File([new Uint8Array(fakeMp4)], "proof.mp4", {
        type: "video/mp4",
      }),
    );
    await submitStepEvidence(
      employeeContext,
      engineAssignment.id,
      startedSession.id,
      engineStepTwoId,
      wrongTypeForm,
      { employeeNote: "", expectedRevision: afterConfirm.revision },
      "verify-phase8-evidence-wrong-type-rejected",
    );
  } catch {
    evidenceOnWrongTypeRejected = true;
  }
  if (!evidenceOnWrongTypeRejected) {
    throw new Error("Video evidence was accepted for a step that only requires a photo");
  }

  const evidenceForm = new FormData();
  evidenceForm.set(
    "file",
    new File([new Uint8Array(smallPng)], "proof.png", { type: "image/png" }),
  );
  const afterEvidence = await submitStepEvidence(
    employeeContext,
    engineAssignment.id,
    startedSession.id,
    engineStepTwoId,
    evidenceForm,
    { employeeNote: "Grill display reads 400F", expectedRevision: afterConfirm.revision },
    "verify-phase8-evidence-upload",
  );
  const stepTwoAfterEvidence = afterEvidence.steps.find((step) => step.id === engineStepTwoId)!;
  if (
    stepTwoAfterEvidence.progress.status !== "completed" ||
    stepTwoAfterEvidence.evidence.length !== 1
  ) {
    throw new Error("Uploading required evidence did not complete the step");
  }
  if (!afterEvidence.allRequiredStepsDone) {
    throw new Error("All required steps were completed but the session did not recognize it");
  }

  const employeeUploadedEvidenceFile = await getMediaFileForEmployee(
    employeeContext,
    stepTwoAfterEvidence.evidence[0]!.fileId,
  );
  if (employeeUploadedEvidenceFile.mimeType !== "image/png") {
    throw new Error("The employee could not read back their own submitted evidence");
  }

  let finalSubmitWithoutAnswerRejected = false;
  try {
    await submitSession(
      employeeContext,
      engineAssignment.id,
      startedSession.id,
      afterEvidence.revision,
      "verify-phase8-submit-without-final-answer-rejected",
    );
  } catch {
    finalSubmitWithoutAnswerRejected = true;
  }
  if (!finalSubmitWithoutAnswerRejected) {
    throw new Error("Submitting without answering the final question was accepted");
  }

  const afterFinalAnswer = await submitAnswer(
    employeeContext,
    engineAssignment.id,
    startedSession.id,
    engineFinalQuestionId,
    [engineFinalCorrectChoiceId],
    afterEvidence.revision,
    "verify-phase8-final-answer",
  );
  if (!afterFinalAnswer.finalQuestionsAnswered) {
    throw new Error("Answering the final question was not recorded");
  }

  const submittedSession = await submitSession(
    employeeContext,
    engineAssignment.id,
    startedSession.id,
    afterFinalAnswer.revision,
    "verify-phase8-submit",
  );
  if (submittedSession.status !== "awaiting_approval") {
    throw new Error("A session with an approval-required step did not route to manager approval");
  }
  if (submittedSession.scorePercent !== 100) {
    throw new Error("A fully correct attempt did not score 100 percent");
  }

  const pendingApprovals = await getDb()
    .select()
    .from(approvalSubmissions)
    .where(eq(approvalSubmissions.sessionId, startedSession.id));
  if (pendingApprovals.length !== 1 || pendingApprovals[0]?.status !== "pending") {
    throw new Error(
      "Submitting a session requiring approval did not create exactly one pending approval submission",
    );
  }

  const idempotentResubmit = await submitSession(
    employeeContext,
    engineAssignment.id,
    startedSession.id,
    afterFinalAnswer.revision,
    "verify-phase8-resubmit-idempotent",
  );
  if (idempotentResubmit.status !== "awaiting_approval") {
    throw new Error("Resubmitting an already-submitted session was not idempotent");
  }
  const approvalsAfterResubmit = await getDb()
    .select()
    .from(approvalSubmissions)
    .where(eq(approvalSubmissions.sessionId, startedSession.id));
  if (approvalsAfterResubmit.length !== 1) {
    throw new Error("An offline retry of submit created a duplicate approval submission");
  }

  // Second fixture: no approval/evidence, used to exercise auto-graded failure and attempt limits.
  const attemptLimitDraft = await createSop(
    managerContext,
    {
      title: "Knife safety quiz",
      description: "Quick knife safety comprehension check",
      category: "safety",
      locationId: seedIds.locations.downtown,
      stationId: seedIds.stations.fry,
      estimatedMinutes: 3,
      difficulty: "beginner",
      coverImageFileId: null,
      sourceVideoFileId: null,
      materials: [],
      warnings: [],
    },
    "verify-phase8-attempt-limit-sop-create",
  );
  const attemptLimitStep = await createStep(
    managerContext,
    attemptLimitDraft.id,
    {
      title: "Answer the safety question",
      instruction: "Answer the knife safety question.",
      imageFileId: null,
      videoFileId: null,
      warning: "",
      quantity: "",
      unit: "",
      equipmentSetting: "",
      timerSeconds: null,
      isRequired: true,
      expectedRevision: attemptLimitDraft.version.revision,
    },
    "verify-phase8-attempt-limit-step-create",
  );
  const attemptLimitStepId = attemptLimitStep.steps[0]!.id;
  const attemptLimitConfig = await updateTrainingConfig(
    managerContext,
    attemptLimitDraft.id,
    {
      requirementState: "required",
      defaultMode: "test",
      allowBacktracking: true,
      requireSequentialProgress: true,
      requireFullVideoWatch: false,
      requireEvidenceApproval: false,
      passingScorePercent: 100,
      maxAttempts: 1,
      qualificationValidityDays: null,
      retrainingGraceDays: null,
      expectedRevision: attemptLimitStep.version.revision,
    },
    "verify-phase8-attempt-limit-config",
  );
  const attemptLimitStepRequirements = await updateStepTrainingRequirements(
    managerContext,
    attemptLimitDraft.id,
    attemptLimitStepId,
    {
      requireFullVideo: false,
      requireConfirmation: false,
      requireTimer: false,
      requireQuestion: true,
      requirePhoto: false,
      requireVideo: false,
      requireApproval: false,
      expectedRevision: attemptLimitConfig.revision,
    },
    "verify-phase8-attempt-limit-step-requirements",
  );
  const attemptLimitQuestion = await createTrainingQuestion(
    managerContext,
    attemptLimitDraft.id,
    {
      stepId: attemptLimitStepId,
      type: "true_false",
      text: "Knives should be carried blade down.",
      explanation: "",
      points: 1,
      placement: "after_step",
      explanationPolicy: "never",
      choices: [
        { text: "True", isCorrect: true },
        { text: "False", isCorrect: false },
      ],
      expectedRevision: attemptLimitStepRequirements.revision,
    },
    "verify-phase8-attempt-limit-question-create",
  );
  const attemptLimitQuestionId = attemptLimitQuestion.questions[0]!.id;
  const attemptLimitWrongChoiceId = attemptLimitQuestion.questions[0]!.choices.find(
    (choice) => !choice.isCorrect,
  )!.id;

  const attemptLimitPublished = await publishSop(
    managerContext,
    attemptLimitDraft.id,
    {
      expectedRevision: attemptLimitQuestion.revision,
      changeSummary: "",
      retrainingRule: { type: "none" },
    },
    "verify-phase8-attempt-limit-publish",
  );
  if (attemptLimitPublished.status !== "published") {
    throw new Error("Publishing the attempt-limit fixture did not succeed");
  }

  const attemptLimitAssignResult = await assignTraining(
    managerContext,
    {
      sopId: attemptLimitDraft.id,
      target: { type: "employees", employeeIds: [employeeSeed[1].id] },
    },
    "verify-phase8-attempt-limit-assign",
  );
  const attemptLimitAssignment = attemptLimitAssignResult.created[0];
  if (!attemptLimitAssignment) {
    throw new Error("The attempt-limit fixture assignment was not created");
  }

  const secondEmployeeLogin = await loginEmployee(
    {
      organizationSlug: "stationsnap-demo",
      locationSlug: "downtown",
      employeeNumber: employeeSeed[1].employeeNumber,
      pin: employeePin,
    },
    { ipHash: "verify-ip-employee-second", requestId: "verify-employee-second-login" },
  );
  const secondEmployeeContext = await getEmployeeSession(secondEmployeeLogin.token);
  if (!secondEmployeeContext) throw new Error("Second employee session verification failed");

  const attemptLimitSession = await startOrResumeSession(
    secondEmployeeContext,
    attemptLimitAssignment.id,
    "verify-phase8-attempt-limit-start",
  );
  const attemptLimitState = await getSessionState(
    secondEmployeeContext,
    attemptLimitAssignment.id,
    attemptLimitSession.id,
  );
  const afterWrongAnswer = await submitAnswer(
    secondEmployeeContext,
    attemptLimitAssignment.id,
    attemptLimitSession.id,
    attemptLimitQuestionId,
    [attemptLimitWrongChoiceId],
    attemptLimitState.revision,
    "verify-phase8-attempt-limit-wrong-answer",
  );
  const failedAttempt = await submitSession(
    secondEmployeeContext,
    attemptLimitAssignment.id,
    attemptLimitSession.id,
    afterWrongAnswer.revision,
    "verify-phase8-attempt-limit-submit-fail",
  );
  if (failedAttempt.status !== "failed" || failedAttempt.scorePercent !== 0) {
    throw new Error("An incorrect attempt did not fail with a zero score");
  }

  let maxAttemptsRejected = false;
  try {
    await startOrResumeSession(
      secondEmployeeContext,
      attemptLimitAssignment.id,
      "verify-phase8-attempt-limit-exhausted",
    );
  } catch {
    maxAttemptsRejected = true;
  }
  if (!maxAttemptsRejected) {
    throw new Error("A new attempt was started after the maximum attempts were exhausted");
  }

  const attemptLimitAssignmentAfter = await getAssignmentDetail(
    secondEmployeeContext,
    attemptLimitAssignment.id,
  );
  if (attemptLimitAssignmentAfter.status !== "failed") {
    throw new Error("The assignment did not move to failed once attempts were exhausted");
  }

  const retrainingAssignResult = await assignTraining(
    managerContext,
    {
      sopId: attemptLimitDraft.id,
      target: { type: "employees", employeeIds: [employeeSeed[1].id] },
    },
    "verify-phase8-retraining-assign",
  );
  const retrainingAssignment = retrainingAssignResult.created[0];
  if (!retrainingAssignment || retrainingAssignment.status !== "assigned") {
    throw new Error(
      "Re-assigning training after exhausted attempts did not create a fresh assignment",
    );
  }
  const [retrainingRow] = await getDb()
    .select({ retrainingGeneration: trainingAssignments.retrainingGeneration })
    .from(trainingAssignments)
    .where(eq(trainingAssignments.id, retrainingAssignment.id));
  if (retrainingRow?.retrainingGeneration !== 1) {
    throw new Error("Retraining assignment did not increment the generation counter");
  }

  // --- Phase 9: bulk assignment targeting, due dates, and duplicate prevention ---

  const bulkDraft = await createSop(
    managerContext,
    {
      title: "Bulk assignment training",
      description: "Minimal training used to exercise bulk assignment targeting",
      category: "general_procedure",
      locationId: seedIds.locations.downtown,
      stationId: null,
      estimatedMinutes: 5,
      difficulty: "beginner",
      coverImageFileId: null,
      sourceVideoFileId: null,
      materials: [],
      warnings: [],
    },
    "verify-phase9-sop-create",
  );
  const bulkStepDraft = await createStep(
    managerContext,
    bulkDraft.id,
    {
      title: "Read the procedure",
      instruction: "Read the bulk assignment training procedure.",
      imageFileId: null,
      videoFileId: null,
      warning: "",
      quantity: "",
      unit: "",
      equipmentSetting: "",
      timerSeconds: null,
      isRequired: true,
      expectedRevision: bulkDraft.version.revision,
    },
    "verify-phase9-step-create",
  );
  const bulkConfig = await updateTrainingConfig(
    managerContext,
    bulkDraft.id,
    {
      requirementState: "required",
      defaultMode: "learn",
      allowBacktracking: true,
      requireSequentialProgress: true,
      requireFullVideoWatch: false,
      requireEvidenceApproval: false,
      passingScorePercent: 80,
      maxAttempts: 3,
      qualificationValidityDays: null,
      retrainingGraceDays: null,
      expectedRevision: bulkStepDraft.version.revision,
    },
    "verify-phase9-config-save",
  );
  const bulkPublished = await publishSop(
    managerContext,
    bulkDraft.id,
    {
      expectedRevision: bulkConfig.revision,
      changeSummary: "",
      retrainingRule: { type: "none" },
    },
    "verify-phase9-publish",
  );
  if (bulkPublished.status !== "published") {
    throw new Error("Publishing the Phase 9 bulk assignment fixture did not succeed");
  }

  let unauthorizedBulkAssignRejected = false;
  try {
    await assignTraining(
      riversideManagerContext,
      { sopId: bulkDraft.id, target: { type: "location" } },
      "verify-phase9-assign-unauthorized-rejected",
    );
  } catch {
    unauthorizedBulkAssignRejected = true;
  }
  if (!unauthorizedBulkAssignRejected) {
    throw new Error("A manager without access to the SOP's location bulk-assigned training");
  }

  const bulkLineCookEmployee = await createEmployee(managerContext, {
    primaryLocationId: seedIds.locations.downtown,
    employeeNumber: "9001",
    displayName: "Bulk Line Cook",
    jobRole: "Line Cook",
    language: "en",
    pin: "9001",
    status: "active",
  });

  const explicitDueDate = "2026-09-01";
  const explicitAssignResult = await assignTraining(
    managerContext,
    {
      sopId: bulkDraft.id,
      dueDate: explicitDueDate,
      target: {
        type: "employees",
        employeeIds: [employeeSeed[2].id, phaseThreeEmployee.id],
      },
    },
    "verify-phase9-assign-employees",
  );
  const expectedDueAt = endOfDayInTimeZone(explicitDueDate, "America/Chicago");
  if (
    explicitAssignResult.created.length !== 1 ||
    explicitAssignResult.created[0]?.employeeId !== employeeSeed[2].id ||
    explicitAssignResult.created[0]?.dueAt?.getTime() !== expectedDueAt.getTime() ||
    explicitAssignResult.created[0]?.dueTimezone !== "America/Chicago"
  ) {
    throw new Error(
      "Bulk assignment by explicit employee list did not resolve the due date correctly",
    );
  }
  if (
    explicitAssignResult.skipped.length !== 1 ||
    explicitAssignResult.skipped[0]?.employeeId !== phaseThreeEmployee.id ||
    explicitAssignResult.skipped[0]?.reason !== "employee_inactive"
  ) {
    throw new Error("A disabled employee targeted explicitly was not independently skipped");
  }

  const matchingRoleAssignResult = await assignTraining(
    managerContext,
    {
      sopId: bulkDraft.id,
      target: { type: "jobRoles", jobRoles: ["line cook"] },
    },
    "verify-phase9-assign-job-role-match",
  );
  if (
    matchingRoleAssignResult.created.length !== 1 ||
    matchingRoleAssignResult.created[0]?.employeeId !== bulkLineCookEmployee.id ||
    matchingRoleAssignResult.skipped.length !== 0
  ) {
    throw new Error(
      "Bulk assignment by job role did not case-insensitively match the intended employee",
    );
  }

  const nonMatchingRoleAssignResult = await assignTraining(
    managerContext,
    {
      sopId: bulkDraft.id,
      target: { type: "jobRoles", jobRoles: ["Sous Chef"] },
    },
    "verify-phase9-assign-job-role-no-match",
  );
  if (
    nonMatchingRoleAssignResult.created.length !== 0 ||
    nonMatchingRoleAssignResult.skipped.length !== 0
  ) {
    throw new Error(
      "Bulk assignment by a non-matching job role unexpectedly created or skipped an assignment",
    );
  }

  const firstLocationAssignResult = await assignTraining(
    managerContext,
    { sopId: bulkDraft.id, target: { type: "location" } },
    "verify-phase9-assign-location-first",
  );
  const firstLocationCreatedIds = new Set(
    firstLocationAssignResult.created.map((row) => row.employeeId),
  );
  const firstLocationSkippedIds = new Set(
    firstLocationAssignResult.skipped.map((row) => row.employeeId),
  );
  if (
    firstLocationAssignResult.created.length !== 2 ||
    !firstLocationCreatedIds.has(employeeSeed[0].id) ||
    !firstLocationCreatedIds.has(employeeSeed[1].id) ||
    firstLocationAssignResult.skipped.length !== 2 ||
    !firstLocationSkippedIds.has(employeeSeed[2].id) ||
    !firstLocationSkippedIds.has(bulkLineCookEmployee.id) ||
    firstLocationAssignResult.skipped.some((row) => row.reason !== "duplicate_active")
  ) {
    throw new Error(
      "Bulk assignment by whole location did not independently create for unassigned employees and skip already-assigned ones",
    );
  }

  const bulkFreshEmployee = await createEmployee(managerContext, {
    primaryLocationId: seedIds.locations.downtown,
    employeeNumber: "9002",
    displayName: "Bulk Fresh Hire",
    jobRole: "Host",
    language: "en",
    pin: "9002",
    status: "active",
  });

  const secondLocationAssignResult = await assignTraining(
    managerContext,
    { sopId: bulkDraft.id, target: { type: "location" } },
    "verify-phase9-assign-location-second",
  );
  if (
    secondLocationAssignResult.created.length !== 1 ||
    secondLocationAssignResult.created[0]?.employeeId !== bulkFreshEmployee.id ||
    secondLocationAssignResult.skipped.length !== 4 ||
    secondLocationAssignResult.skipped.some((row) => row.reason !== "duplicate_active")
  ) {
    throw new Error(
      "Re-running the same location target did not skip already-assigned employees while still assigning the fresh hire",
    );
  }

  // --- Phase 10: immutable approval decisions and correction evidence history ---

  // The Phase 8 engine session is still sitting in `awaiting_approval` with exactly one pending
  // submission; it is the natural fixture for a full needs_correction -> resubmit -> approved loop.
  const [engineSubmission] = await getDb()
    .select()
    .from(approvalSubmissions)
    .where(eq(approvalSubmissions.sessionId, startedSession.id));
  if (!engineSubmission || engineSubmission.status !== "pending") {
    throw new Error("The Phase 8 approval submission was not available for Phase 10 review");
  }

  const ownerQueue = await listApprovalQueue(managerContext, { status: "pending", locationId: "" });
  const queuedSubmission = ownerQueue.find((row) => row.id === engineSubmission.id);
  if (
    !queuedSubmission ||
    queuedSubmission.employeeId !== employeeSeed[0].id ||
    queuedSubmission.locationId !== seedIds.locations.downtown ||
    queuedSubmission.submissionGeneration !== 1
  ) {
    throw new Error("The pending submission did not appear in the owner's approval queue");
  }

  const foreignQueue = await listApprovalQueue(riversideManagerContext, {
    status: "pending",
    locationId: "",
  });
  if (foreignQueue.some((row) => row.id === engineSubmission.id)) {
    throw new Error("A manager saw an approval submission outside their permitted locations");
  }
  const spoofedLocationQueue = await listApprovalQueue(riversideManagerContext, {
    status: "pending",
    locationId: seedIds.locations.downtown,
  });
  if (spoofedLocationQueue.length !== 0) {
    throw new Error("A client-supplied location filter widened a manager's approval queue scope");
  }

  let foreignApprovalDetailRejected = false;
  try {
    await getApprovalSubmissionDetail(riversideManagerContext, engineSubmission.id);
  } catch {
    foreignApprovalDetailRejected = true;
  }
  if (!foreignApprovalDetailRejected) {
    throw new Error("A manager opened an approval submission outside their permitted locations");
  }

  let foreignApprovalDecisionRejected = false;
  try {
    await decideApprovalSubmission(
      riversideManagerContext,
      engineSubmission.id,
      { decision: "approved", note: "" },
      "verify-phase10-decide-unauthorized-rejected",
    );
  } catch {
    foreignApprovalDecisionRejected = true;
  }
  if (!foreignApprovalDecisionRejected) {
    throw new Error("A manager decided an approval submission outside their permitted locations");
  }

  const reviewDetail = await getApprovalSubmissionDetail(managerContext, engineSubmission.id);
  if (
    reviewDetail.evidence.length !== 1 ||
    reviewDetail.evidence[0]?.submissionGeneration !== 1 ||
    reviewDetail.quiz.totalQuestions !== 2 ||
    reviewDetail.quiz.correctAnswers !== 2 ||
    !reviewDetail.submission.isDecidable
  ) {
    throw new Error("The approval review did not expose the submitted evidence and quiz summary");
  }
  const originalEvidenceFileId = reviewDetail.evidence[0]!.fileId;

  const reviewedEvidenceFile = await getMediaFile(managerContext, originalEvidenceFileId);
  if (reviewedEvidenceFile.mimeType !== "image/png") {
    throw new Error("A reviewing manager could not read the submitted evidence file");
  }
  let foreignEvidenceReadRejected = false;
  try {
    await getMediaFile(riversideManagerContext, originalEvidenceFileId);
  } catch {
    foreignEvidenceReadRejected = true;
  }
  if (!foreignEvidenceReadRejected) {
    throw new Error("A manager read employee evidence from a location they do not manage");
  }

  // Note rules live in the shared decision schema, which is what every API route parses.
  for (const decision of ["rejected", "needs_correction"] as const) {
    if (approvalDecisionSchema.safeParse({ decision }).success) {
      throw new Error(`A ${decision} decision was accepted without a note`);
    }
    if (approvalDecisionSchema.safeParse({ decision, note: "   " }).success) {
      throw new Error(`A ${decision} decision was accepted with a blank note`);
    }
  }
  if (!approvalDecisionSchema.safeParse({ decision: "approved" }).success) {
    throw new Error("An approval was rejected for omitting an optional note");
  }

  const correctionNote = "Retake the grill photo with the display in frame.";
  const afterCorrectionRequest = await decideApprovalSubmission(
    managerContext,
    engineSubmission.id,
    { decision: "needs_correction", note: correctionNote },
    "verify-phase10-needs-correction",
  );
  if (
    afterCorrectionRequest.submission.status !== "needs_correction" ||
    afterCorrectionRequest.session.status !== "awaiting_approval"
  ) {
    throw new Error(
      "Requesting a correction did not hold the session in awaiting_approval with a corrected submission",
    );
  }
  const [openCorrection] = await getDb()
    .select()
    .from(correctionRequests)
    .where(eq(correctionRequests.submissionId, engineSubmission.id));
  if (
    !openCorrection ||
    openCorrection.replacementGeneration !== 2 ||
    openCorrection.resolvedAt !== null ||
    openCorrection.resolvedSubmissionId !== null
  ) {
    throw new Error("Requesting a correction did not open exactly one unresolved correction row");
  }

  let doubleDecisionRejected = false;
  try {
    await decideApprovalSubmission(
      managerContext,
      engineSubmission.id,
      { decision: "approved", note: "" },
      "verify-phase10-double-decision-rejected",
    );
  } catch {
    doubleDecisionRejected = true;
  }
  if (!doubleDecisionRejected) {
    throw new Error("An already-decided submission was decided a second time");
  }
  const decisionsAfterDoubleAttempt = await getDb()
    .select()
    .from(approvalDecisions)
    .where(eq(approvalDecisions.submissionId, engineSubmission.id));
  if (decisionsAfterDoubleAttempt.length !== 1) {
    throw new Error("A rejected second decision still wrote a decision row");
  }

  let foreignCorrectionDetailRejected = false;
  try {
    await getEmployeeCorrectionDetail(secondEmployeeContext, engineSubmission.id);
  } catch {
    foreignCorrectionDetailRejected = true;
  }
  if (!foreignCorrectionDetailRejected) {
    throw new Error("An employee opened another employee's correction request");
  }

  const correctionDetail = await getEmployeeCorrectionDetail(employeeContext, engineSubmission.id);
  if (
    !correctionDetail.correction.isOpen ||
    correctionDetail.correction.managerNote !== correctionNote ||
    correctionDetail.correction.replacementGeneration !== 2
  ) {
    throw new Error("The employee correction view did not surface the open request and its note");
  }
  const correctionStep = correctionDetail.steps.find((step) => step.id === engineStepTwoId);
  if (!correctionStep || correctionStep.evidence.length !== 1) {
    throw new Error("The employee correction view did not keep the original evidence visible");
  }

  let foreignResubmitRejected = false;
  try {
    const foreignForm = new FormData();
    foreignForm.set(
      "file",
      new File([new Uint8Array(smallPng)], "not-mine.png", { type: "image/png" }),
    );
    await resubmitCorrection(
      secondEmployeeContext,
      engineSubmission.id,
      foreignForm,
      { stepId: engineStepTwoId, employeeNote: "", expectedRevision: 1 },
      "verify-phase10-resubmit-unauthorized-rejected",
    );
  } catch {
    foreignResubmitRejected = true;
  }
  if (!foreignResubmitRejected) {
    throw new Error("An employee resubmitted against another employee's correction request");
  }

  const replacementForm = new FormData();
  replacementForm.set(
    "file",
    new File([new Uint8Array(smallPng)], "fixed-proof.png", { type: "image/png" }),
  );
  const afterResubmit = await resubmitCorrection(
    employeeContext,
    engineSubmission.id,
    replacementForm,
    {
      stepId: engineStepTwoId,
      employeeNote: "Retook the photo with the display in frame.",
      expectedRevision: correctionDetail.session.revision,
    },
    "verify-phase10-resubmit",
  );
  if (afterResubmit.correction.isOpen || afterResubmit.correction.resolvedAt === null) {
    throw new Error("Resubmitting a correction did not resolve the correction request");
  }
  const resubmittedStep = afterResubmit.steps.find((step) => step.id === engineStepTwoId);
  if (
    !resubmittedStep ||
    resubmittedStep.evidence.length !== 2 ||
    resubmittedStep.evidence[0]?.fileId !== originalEvidenceFileId ||
    resubmittedStep.evidence[1]?.submissionGeneration !== 2
  ) {
    throw new Error(
      "Replacement evidence overwrote the original instead of adding an append-only generation",
    );
  }

  const replacementSubmissionId = afterResubmit.correction.resolvedSubmissionId;
  if (!replacementSubmissionId) {
    throw new Error("Resolving a correction did not record the replacement submission");
  }
  const [replacementSubmission] = await getDb()
    .select()
    .from(approvalSubmissions)
    .where(eq(approvalSubmissions.id, replacementSubmissionId));
  if (
    !replacementSubmission ||
    replacementSubmission.status !== "pending" ||
    replacementSubmission.submissionGeneration !== 2
  ) {
    throw new Error("Resubmitting a correction did not open a new pending submission generation");
  }

  let duplicateResubmitRejected = false;
  try {
    const duplicateForm = new FormData();
    duplicateForm.set(
      "file",
      new File([new Uint8Array(smallPng)], "again.png", { type: "image/png" }),
    );
    await resubmitCorrection(
      employeeContext,
      engineSubmission.id,
      duplicateForm,
      {
        stepId: engineStepTwoId,
        employeeNote: "",
        expectedRevision: afterResubmit.session.revision,
      },
      "verify-phase10-resubmit-duplicate-rejected",
    );
  } catch {
    duplicateResubmitRejected = true;
  }
  if (!duplicateResubmitRejected) {
    throw new Error("An already-resolved correction accepted a second resubmission");
  }
  const submissionsAfterDuplicateResubmit = await getDb()
    .select()
    .from(approvalSubmissions)
    .where(eq(approvalSubmissions.sessionId, startedSession.id));
  if (submissionsAfterDuplicateResubmit.length !== 2) {
    throw new Error("A rejected duplicate resubmission still created another submission");
  }

  const afterApproval = await decideApprovalSubmission(
    managerContext,
    replacementSubmissionId,
    { decision: "approved", note: "" },
    "verify-phase10-approve",
  );
  if (afterApproval.submission.status !== "approved" || afterApproval.session.status !== "passed") {
    throw new Error("An approval did not resolve the session to passed");
  }
  const approvedAssignment = await getAssignmentDetail(employeeContext, engineAssignment.id);
  if (approvedAssignment.status !== "completed") {
    throw new Error("An approval did not complete the training assignment");
  }

  // Both rounds of the loop must still be readable: history is appended, never overwritten.
  if (
    afterApproval.decisions.length !== 2 ||
    afterApproval.decisions[0]?.decision !== "needs_correction" ||
    afterApproval.decisions[0]?.note !== correctionNote ||
    afterApproval.decisions[0]?.submissionGeneration !== 1 ||
    afterApproval.decisions[1]?.decision !== "approved" ||
    afterApproval.decisions[1]?.submissionGeneration !== 2
  ) {
    throw new Error("The decision history did not retain every round of the correction loop");
  }
  if (
    afterApproval.corrections.length !== 1 ||
    afterApproval.corrections[0]?.managerNote !== correctionNote ||
    afterApproval.corrections[0]?.resolvedSubmissionId !== replacementSubmissionId
  ) {
    throw new Error("The correction history did not retain the resolved round");
  }
  if (afterApproval.evidence.length !== 2) {
    throw new Error("The reviewer lost sight of an earlier evidence generation after approval");
  }
  const supersededDetail = await getApprovalSubmissionDetail(managerContext, engineSubmission.id);
  if (
    supersededDetail.submission.status !== "needs_correction" ||
    supersededDetail.submission.isDecidable
  ) {
    throw new Error("A superseded submission generation was mutated or became decidable again");
  }

  // A second fixture exercises the rejection path, which ends an attempt rather than reopening it.
  const rejectionDraft = await createSop(
    managerContext,
    {
      title: "Walk-in cooler demonstration",
      description: "Demonstration reviewed by a manager before it counts",
      category: "cleaning",
      locationId: seedIds.locations.downtown,
      stationId: seedIds.stations.fry,
      estimatedMinutes: 4,
      difficulty: "beginner",
      coverImageFileId: null,
      sourceVideoFileId: null,
      materials: [],
      warnings: [],
    },
    "verify-phase10-rejection-sop-create",
  );
  const rejectionStepDraft = await createStep(
    managerContext,
    rejectionDraft.id,
    {
      title: "Photograph the cleaned shelving",
      instruction: "Clean the shelving and photograph the result.",
      imageFileId: null,
      videoFileId: null,
      warning: "",
      quantity: "",
      unit: "",
      equipmentSetting: "",
      timerSeconds: null,
      isRequired: true,
      expectedRevision: rejectionDraft.version.revision,
    },
    "verify-phase10-rejection-step-create",
  );
  const rejectionStepId = rejectionStepDraft.steps[0]!.id;
  const rejectionConfig = await updateTrainingConfig(
    managerContext,
    rejectionDraft.id,
    {
      requirementState: "required",
      defaultMode: "demonstration",
      allowBacktracking: true,
      requireSequentialProgress: true,
      requireFullVideoWatch: false,
      requireEvidenceApproval: true,
      passingScorePercent: 80,
      maxAttempts: 2,
      qualificationValidityDays: null,
      retrainingGraceDays: null,
      expectedRevision: rejectionStepDraft.version.revision,
    },
    "verify-phase10-rejection-config",
  );
  const rejectionRequirements = await updateStepTrainingRequirements(
    managerContext,
    rejectionDraft.id,
    rejectionStepId,
    {
      requireFullVideo: false,
      requireConfirmation: false,
      requireTimer: false,
      requireQuestion: false,
      requirePhoto: true,
      requireVideo: false,
      requireApproval: true,
      expectedRevision: rejectionConfig.revision,
    },
    "verify-phase10-rejection-step-requirements",
  );
  const rejectionQuestion = await createTrainingQuestion(
    managerContext,
    rejectionDraft.id,
    {
      stepId: null,
      type: "true_false",
      text: "Shelving must be dry before restocking.",
      explanation: "",
      points: 1,
      placement: "final",
      explanationPolicy: "never",
      choices: [
        { text: "True", isCorrect: true },
        { text: "False", isCorrect: false },
      ],
      expectedRevision: rejectionRequirements.revision,
    },
    "verify-phase10-rejection-question",
  );
  const rejectionQuestionId = rejectionQuestion.questions[0]!.id;
  const rejectionCorrectChoiceId = rejectionQuestion.questions[0]!.choices.find(
    (choice) => choice.isCorrect,
  )!.id;

  const rejectionPublished = await publishSop(
    managerContext,
    rejectionDraft.id,
    {
      expectedRevision: rejectionQuestion.revision,
      changeSummary: "",
      retrainingRule: { type: "none" },
    },
    "verify-phase10-rejection-publish",
  );
  if (rejectionPublished.status !== "published") {
    throw new Error("Publishing the Phase 10 rejection fixture did not succeed");
  }

  const rejectionAssignResult = await assignTraining(
    managerContext,
    {
      sopId: rejectionDraft.id,
      target: { type: "employees", employeeIds: [employeeSeed[1].id] },
    },
    "verify-phase10-rejection-assign",
  );
  const rejectionAssignment = rejectionAssignResult.created[0];
  if (!rejectionAssignment) throw new Error("The Phase 10 rejection assignment was not created");

  const rejectionSession = await startOrResumeSession(
    secondEmployeeContext,
    rejectionAssignment.id,
    "verify-phase10-rejection-start",
  );
  const rejectionState = await getSessionState(
    secondEmployeeContext,
    rejectionAssignment.id,
    rejectionSession.id,
  );
  const rejectionEvidenceForm = new FormData();
  rejectionEvidenceForm.set(
    "file",
    new File([new Uint8Array(smallPng)], "shelving.png", { type: "image/png" }),
  );
  const afterRejectionEvidence = await submitStepEvidence(
    secondEmployeeContext,
    rejectionAssignment.id,
    rejectionSession.id,
    rejectionStepId,
    rejectionEvidenceForm,
    { employeeNote: "", expectedRevision: rejectionState.revision },
    "verify-phase10-rejection-evidence",
  );
  const afterRejectionAnswer = await submitAnswer(
    secondEmployeeContext,
    rejectionAssignment.id,
    rejectionSession.id,
    rejectionQuestionId,
    [rejectionCorrectChoiceId],
    afterRejectionEvidence.revision,
    "verify-phase10-rejection-answer",
  );
  const rejectionSubmitted = await submitSession(
    secondEmployeeContext,
    rejectionAssignment.id,
    rejectionSession.id,
    afterRejectionAnswer.revision,
    "verify-phase10-rejection-submit",
  );
  if (rejectionSubmitted.status !== "awaiting_approval") {
    throw new Error("The Phase 10 rejection fixture did not route to manager approval");
  }
  const [rejectionSubmission] = await getDb()
    .select()
    .from(approvalSubmissions)
    .where(eq(approvalSubmissions.sessionId, rejectionSession.id));
  if (!rejectionSubmission) throw new Error("The rejection fixture created no approval submission");

  const rejectionNote = "The back shelf is still soiled. This attempt does not pass.";
  const afterRejection = await decideApprovalSubmission(
    managerContext,
    rejectionSubmission.id,
    { decision: "rejected", note: rejectionNote },
    "verify-phase10-reject",
  );
  if (
    afterRejection.submission.status !== "rejected" ||
    afterRejection.session.status !== "failed"
  ) {
    throw new Error("A rejection did not resolve the session to failed");
  }
  const rejectedAssignment = await getAssignmentDetail(
    secondEmployeeContext,
    rejectionAssignment.id,
  );
  if (rejectedAssignment.status !== "in_progress") {
    throw new Error(
      "A rejection with attempts remaining did not leave the assignment open for another attempt",
    );
  }
  if (
    afterRejection.decisions.length !== 1 ||
    afterRejection.decisions[0]?.note !== rejectionNote ||
    afterRejection.decisions[0]?.decidedByManagerUserId !== managerContext.managerUserId
  ) {
    throw new Error("A rejection did not record its manager, note, and decision permanently");
  }

  // --- Phase 11: ordered training paths and qualification lifecycle ---

  const pathSopA = await createMinimalPublishedSop(
    managerContext,
    "Grill Safety Basics",
    seedIds.locations.downtown,
    "verify-phase11-sop-a",
  );
  const pathSopB = await createMinimalPublishedSop(
    managerContext,
    "Grill Safety Advanced",
    seedIds.locations.downtown,
    "verify-phase11-sop-b",
  );

  let unauthorizedPathCreateRejected = false;
  try {
    await createPath(
      riversideManagerContext,
      {
        title: "Grill Certification",
        description: "",
        locationId: seedIds.locations.downtown,
        stationId: null,
        enforceOrder: true,
        status: "active",
        definition: { name: "Grill Certified", description: "", defaultValidityDays: 90 },
        items: [
          { sopId: pathSopA.id, isRequired: true, versionPolicy: "current_version" },
          { sopId: pathSopB.id, isRequired: true, versionPolicy: "any_passed_version" },
        ],
      },
      "verify-phase11-path-create-unauthorized-rejected",
    );
  } catch {
    unauthorizedPathCreateRejected = true;
  }
  if (!unauthorizedPathCreateRejected) {
    throw new Error("A manager without access to the location created a training path");
  }

  const unpublishedDraft = await createSop(
    managerContext,
    {
      title: "Still A Draft",
      description: "",
      category: "general_procedure",
      locationId: seedIds.locations.downtown,
      stationId: null,
      estimatedMinutes: 5,
      difficulty: "beginner",
      coverImageFileId: null,
      sourceVideoFileId: null,
      materials: [],
      warnings: [],
    },
    "verify-phase11-unpublished-sop-create",
  );
  let unpublishedItemRejected = false;
  try {
    await createPath(
      managerContext,
      {
        title: "Invalid Path Unpublished",
        description: "",
        locationId: seedIds.locations.downtown,
        stationId: null,
        enforceOrder: true,
        status: "active",
        definition: { name: "Invalid Unpublished", description: "", defaultValidityDays: null },
        items: [{ sopId: unpublishedDraft.id, isRequired: true, versionPolicy: "current_version" }],
      },
      "verify-phase11-path-create-unpublished-rejected",
    );
  } catch {
    unpublishedItemRejected = true;
  }
  if (!unpublishedItemRejected) {
    throw new Error("A training path accepted an unpublished SOP as an item");
  }

  let wrongLocationItemRejected = false;
  try {
    await createPath(
      managerContext,
      {
        title: "Invalid Path Wrong Location",
        description: "",
        locationId: seedIds.locations.riverside,
        stationId: null,
        enforceOrder: true,
        status: "active",
        definition: { name: "Invalid Wrong Location", description: "", defaultValidityDays: null },
        items: [{ sopId: pathSopA.id, isRequired: true, versionPolicy: "current_version" }],
      },
      "verify-phase11-path-create-wrong-location-rejected",
    );
  } catch {
    wrongLocationItemRejected = true;
  }
  if (!wrongLocationItemRejected) {
    throw new Error("A training path accepted an SOP from another location as an item");
  }

  const grillPath = await createPath(
    managerContext,
    {
      title: "Grill Certification",
      description: "Two-step grill certification path",
      locationId: seedIds.locations.downtown,
      stationId: null,
      enforceOrder: true,
      status: "active",
      definition: { name: "Grill Certified", description: "", defaultValidityDays: 90 },
      items: [
        { sopId: pathSopA.id, isRequired: true, versionPolicy: "current_version" },
        { sopId: pathSopB.id, isRequired: true, versionPolicy: "any_passed_version" },
      ],
    },
    "verify-phase11-path-create",
  );
  if (
    grillPath.enforceOrder !== true ||
    grillPath.items.length !== 2 ||
    grillPath.items[0]?.sopId !== pathSopA.id ||
    grillPath.items[0]?.displayOrder !== 1 ||
    grillPath.items[1]?.sopId !== pathSopB.id ||
    grillPath.items[1]?.displayOrder !== 2 ||
    grillPath.definition.defaultValidityDays !== 90
  ) {
    throw new Error("Creating a training path did not persist its ordered items and definition");
  }

  const foreignPaths = await listPaths(riversideManagerContext, { locationId: "", status: "" });
  if (foreignPaths.some((row) => row.id === grillPath.id)) {
    throw new Error("A manager saw a training path outside their permitted locations");
  }
  let foreignPathDetailRejected = false;
  try {
    await getPathDetail(riversideManagerContext, grillPath.id);
  } catch {
    foreignPathDetailRejected = true;
  }
  if (!foreignPathDetailRejected) {
    throw new Error("A manager opened a training path outside their permitted locations");
  }

  // Completing the required items out of order must never award the qualification, even once
  // every item individually has a passing completion.
  const outOfOrderAssignA = await assignTraining(
    managerContext,
    { sopId: pathSopA.id, target: { type: "employees", employeeIds: [employeeSeed[0].id] } },
    "verify-phase11-outoforder-assign-a",
  );
  const outOfOrderAssignB = await assignTraining(
    managerContext,
    { sopId: pathSopB.id, target: { type: "employees", employeeIds: [employeeSeed[0].id] } },
    "verify-phase11-outoforder-assign-b",
  );
  const outOfOrderAssignmentA = outOfOrderAssignA.created[0];
  const outOfOrderAssignmentB = outOfOrderAssignB.created[0];
  if (!outOfOrderAssignmentA || !outOfOrderAssignmentB) {
    throw new Error("The out-of-order Phase 11 fixture assignments were not created");
  }
  await completeMinimalAssignment(
    employeeContext,
    outOfOrderAssignmentB.id,
    "verify-phase11-outoforder-complete-b-first",
  );
  await completeMinimalAssignment(
    employeeContext,
    outOfOrderAssignmentA.id,
    "verify-phase11-outoforder-complete-a-second",
  );
  const outOfOrderQualifications = await getDb()
    .select()
    .from(employeeQualifications)
    .where(eq(employeeQualifications.employeeId, employeeSeed[0].id));
  if (outOfOrderQualifications.length !== 0) {
    throw new Error(
      "An ordered path awarded a qualification despite its required items completing out of order",
    );
  }

  // Completing the same required items in order awards the qualification, with expiresAt derived
  // from the definition's defaultValidityDays.
  const inOrderAssignA = await assignTraining(
    managerContext,
    { sopId: pathSopA.id, target: { type: "employees", employeeIds: [employeeSeed[1].id] } },
    "verify-phase11-inorder-assign-a",
  );
  const inOrderAssignB = await assignTraining(
    managerContext,
    { sopId: pathSopB.id, target: { type: "employees", employeeIds: [employeeSeed[1].id] } },
    "verify-phase11-inorder-assign-b",
  );
  const inOrderAssignmentA = inOrderAssignA.created[0];
  const inOrderAssignmentB = inOrderAssignB.created[0];
  if (!inOrderAssignmentA || !inOrderAssignmentB) {
    throw new Error("The in-order Phase 11 fixture assignments were not created");
  }
  const inOrderCompletedA = await completeMinimalAssignment(
    secondEmployeeContext,
    inOrderAssignmentA.id,
    "verify-phase11-inorder-complete-a",
  );
  const inOrderCompletedB = await completeMinimalAssignment(
    secondEmployeeContext,
    inOrderAssignmentB.id,
    "verify-phase11-inorder-complete-b",
  );

  const [luisQualification] = await getDb()
    .select()
    .from(employeeQualifications)
    .where(eq(employeeQualifications.employeeId, employeeSeed[1].id));
  if (!luisQualification || luisQualification.status !== "active") {
    throw new Error(
      "Completing an ordered path's required items in order did not award a qualification",
    );
  }
  const expectedExpiresAt = new Date(
    luisQualification.awardedAt.getTime() + 90 * 24 * 60 * 60 * 1000,
  );
  if (
    !luisQualification.expiresAt ||
    Math.abs(luisQualification.expiresAt.getTime() - expectedExpiresAt.getTime()) > 1_000
  ) {
    throw new Error(
      "The awarded qualification's expiresAt was not derived from defaultValidityDays",
    );
  }
  const luisSupportingSessions = await getDb()
    .select()
    .from(qualificationSupportingSessions)
    .where(eq(qualificationSupportingSessions.qualificationId, luisQualification.id));
  if (luisSupportingSessions.length !== 2) {
    throw new Error(
      "The awarded qualification did not link exactly one supporting session per required item",
    );
  }

  // Renewal: republishing the second SOP and passing the new version (the item's policy is
  // any_passed_version) must update the same still-active episode in place — new awardedAt and
  // expiresAt, and its supporting sessions replaced rather than duplicated — never a second row.
  const pathSopBDraft = await createDraftFromCurrentVersion(
    managerContext,
    pathSopB.id,
    "verify-phase11-sopb-draft",
  );
  const pathSopBRepublished = await publishSop(
    managerContext,
    pathSopB.id,
    {
      expectedRevision: pathSopBDraft.version.revision,
      changeSummary: "Refreshed the grill advanced procedure wording.",
      retrainingRule: { type: "none" },
    },
    "verify-phase11-sopb-v2-publish",
  );
  if (
    pathSopBRepublished.currentVersionId === null ||
    pathSopBRepublished.currentVersionId === pathSopB.currentVersionId
  ) {
    throw new Error("Republishing the Phase 11 fixture SOP did not produce a new current version");
  }
  const renewAssignResult = await assignTraining(
    managerContext,
    { sopId: pathSopB.id, target: { type: "employees", employeeIds: [employeeSeed[1].id] } },
    "verify-phase11-renew-assign",
  );
  const renewAssignment = renewAssignResult.created[0];
  if (!renewAssignment) throw new Error("The renewal Phase 11 fixture assignment was not created");
  const renewCompleted = await completeMinimalAssignment(
    secondEmployeeContext,
    renewAssignment.id,
    "verify-phase11-renew-complete",
  );

  const allLuisQualifications = await getDb()
    .select()
    .from(employeeQualifications)
    .where(eq(employeeQualifications.employeeId, employeeSeed[1].id));
  if (allLuisQualifications.length !== 1 || allLuisQualifications[0]?.id !== luisQualification.id) {
    throw new Error(
      "Renewal opened a new qualification episode instead of updating the existing active one",
    );
  }
  if (allLuisQualifications[0]!.awardedAt.getTime() <= luisQualification.awardedAt.getTime()) {
    throw new Error("Renewal did not advance the qualification's awardedAt");
  }
  const luisSupportingSessionsAfterRenewal = await getDb()
    .select()
    .from(qualificationSupportingSessions)
    .where(eq(qualificationSupportingSessions.qualificationId, luisQualification.id));
  const renewedSessionIds = new Set(luisSupportingSessionsAfterRenewal.map((row) => row.sessionId));
  if (
    luisSupportingSessionsAfterRenewal.length !== 2 ||
    !renewedSessionIds.has(inOrderCompletedA.id) ||
    !renewedSessionIds.has(renewCompleted.id) ||
    renewedSessionIds.has(inOrderCompletedB.id)
  ) {
    throw new Error(
      "Renewal did not replace exactly the superseded item's supporting session while keeping the other",
    );
  }

  // Overview classification: training (assigned but not completed), missing (no assignment or
  // episode), qualified/expiring (an active episode within/outside the 30-day window), and
  // expired (an active-status episode whose expiry has passed).
  const trainingTabAssign = await assignTraining(
    managerContext,
    { sopId: pathSopA.id, target: { type: "employees", employeeIds: [employeeSeed[2].id] } },
    "verify-phase11-training-tab-assign",
  );
  if (trainingTabAssign.created.length !== 1) {
    throw new Error("The training-tab Phase 11 fixture assignment was not created");
  }

  const missingTabEmployee = await createEmployee(managerContext, {
    primaryLocationId: seedIds.locations.downtown,
    employeeNumber: "9101",
    displayName: "Riley Missing",
    jobRole: "Dishwasher",
    language: "en",
    pin: "9101",
    status: "active",
  });

  const expiringSoonEmployee = await createEmployee(managerContext, {
    primaryLocationId: seedIds.locations.downtown,
    employeeNumber: "9102",
    displayName: "Sam Soon",
    jobRole: "Cook",
    language: "en",
    pin: "9102",
    status: "active",
  });
  const expiringAssignA = await assignTraining(
    managerContext,
    { sopId: pathSopA.id, target: { type: "employees", employeeIds: [expiringSoonEmployee.id] } },
    "verify-phase11-expiring-assign-a",
  );
  const expiringAssignB = await assignTraining(
    managerContext,
    { sopId: pathSopB.id, target: { type: "employees", employeeIds: [expiringSoonEmployee.id] } },
    "verify-phase11-expiring-assign-b",
  );
  const expiringAssignmentA = expiringAssignA.created[0];
  const expiringAssignmentB = expiringAssignB.created[0];
  if (!expiringAssignmentA || !expiringAssignmentB) {
    throw new Error("The expiring-soon Phase 11 fixture assignments were not created");
  }
  const samContext = await loginNewEmployee("9102", "9102", "phase11-sam");
  await completeMinimalAssignment(
    samContext,
    expiringAssignmentA.id,
    "verify-phase11-expiring-complete-a",
  );
  await completeMinimalAssignment(
    samContext,
    expiringAssignmentB.id,
    "verify-phase11-expiring-complete-b",
  );
  const [samQualification] = await getDb()
    .select()
    .from(employeeQualifications)
    .where(eq(employeeQualifications.employeeId, expiringSoonEmployee.id));
  if (!samQualification) throw new Error("Sam's in-order completion did not award a qualification");
  // Simulate the passage of time: move this episode's expiry into the 30-day "expiring soon" window.
  await getDb()
    .update(employeeQualifications)
    .set({ expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000) })
    .where(eq(employeeQualifications.id, samQualification.id));

  const lapsedEmployee = await createEmployee(managerContext, {
    primaryLocationId: seedIds.locations.downtown,
    employeeNumber: "9103",
    displayName: "Jamie Lapsed",
    jobRole: "Cook",
    language: "en",
    pin: "9103",
    status: "active",
  });
  const lapsedAssignA = await assignTraining(
    managerContext,
    { sopId: pathSopA.id, target: { type: "employees", employeeIds: [lapsedEmployee.id] } },
    "verify-phase11-lapsed-assign-a",
  );
  const lapsedAssignB = await assignTraining(
    managerContext,
    { sopId: pathSopB.id, target: { type: "employees", employeeIds: [lapsedEmployee.id] } },
    "verify-phase11-lapsed-assign-b",
  );
  const lapsedAssignmentA = lapsedAssignA.created[0];
  const lapsedAssignmentB = lapsedAssignB.created[0];
  if (!lapsedAssignmentA || !lapsedAssignmentB) {
    throw new Error("The lapsed Phase 11 fixture assignments were not created");
  }
  const jamieContext = await loginNewEmployee("9103", "9103", "phase11-jamie");
  await completeMinimalAssignment(
    jamieContext,
    lapsedAssignmentA.id,
    "verify-phase11-lapsed-complete-a",
  );
  await completeMinimalAssignment(
    jamieContext,
    lapsedAssignmentB.id,
    "verify-phase11-lapsed-complete-b",
  );
  const [jamieQualification] = await getDb()
    .select()
    .from(employeeQualifications)
    .where(eq(employeeQualifications.employeeId, lapsedEmployee.id));
  if (!jamieQualification) {
    throw new Error("Jamie's in-order completion did not award a qualification");
  }
  await getDb()
    .update(employeeQualifications)
    .set({ expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) })
    .where(eq(employeeQualifications.id, jamieQualification.id));

  const overviewAll = await listQualificationsOverview(managerContext, {
    locationId: seedIds.locations.downtown,
    tab: "",
  });
  const findOverviewRow = (employeeId: string) =>
    overviewAll.find(
      (row) => row.employeeId === employeeId && row.definitionId === grillPath.definition.id,
    );
  const mayaRow = findOverviewRow(employeeSeed[0].id);
  if (!mayaRow || mayaRow.classification !== "missing") {
    throw new Error(
      "The overview did not classify the out-of-order employee as missing (no episode, no non-terminal assignment)",
    );
  }
  const luisRow = findOverviewRow(employeeSeed[1].id);
  if (!luisRow || luisRow.classification !== "qualified" || luisRow.isExpiringSoon) {
    throw new Error("The overview did not classify the renewed employee as qualified");
  }
  const taylorRow = findOverviewRow(employeeSeed[2].id);
  if (!taylorRow || taylorRow.classification !== "training") {
    throw new Error("The overview did not classify the in-progress employee as training");
  }
  const rileyRow = findOverviewRow(missingTabEmployee.id);
  if (!rileyRow || rileyRow.classification !== "missing") {
    throw new Error("The overview did not classify the untouched employee as missing");
  }
  const samRow = findOverviewRow(expiringSoonEmployee.id);
  if (!samRow || samRow.classification !== "qualified" || !samRow.isExpiringSoon) {
    throw new Error(
      "The overview did not classify the near-expiry employee as qualified and expiring soon",
    );
  }
  const jamieRow = findOverviewRow(lapsedEmployee.id);
  if (!jamieRow || jamieRow.classification !== "expired") {
    throw new Error("The overview did not classify the lapsed employee as expired");
  }
  const expiringTabOnly = await listQualificationsOverview(managerContext, {
    locationId: seedIds.locations.downtown,
    tab: "expiring",
  });
  if (
    !expiringTabOnly.some((row) => row.employeeId === expiringSoonEmployee.id) ||
    expiringTabOnly.some((row) => row.employeeId === lapsedEmployee.id)
  ) {
    throw new Error("The expiring tab did not select exactly the near-expiry employee");
  }

  const luisSections = await listQualificationsForEmployee(secondEmployeeContext);
  if (!luisSections.earned.some((row) => row.definitionId === grillPath.definition.id)) {
    throw new Error("The employee qualification view did not list the earned qualification");
  }
  const samSections = await listQualificationsForEmployee(samContext);
  if (!samSections.expiring.some((row) => row.definitionId === grillPath.definition.id)) {
    throw new Error(
      "The employee qualification view did not list the near-expiry qualification as expiring",
    );
  }
  const taylorContext = await loginNewEmployee(
    employeeSeed[2].employeeNumber,
    employeePin,
    "phase11-taylor",
  );
  const taylorSections = await listQualificationsForEmployee(taylorContext);
  if (!taylorSections.inProgress.some((row) => row.definitionId === grillPath.definition.id)) {
    throw new Error("The employee qualification view did not list the in-progress path");
  }

  let foreignEmployeeQualificationRejected = false;
  try {
    await getQualificationDetailForEmployee(employeeContext, luisQualification.id);
  } catch {
    foreignEmployeeQualificationRejected = true;
  }
  if (!foreignEmployeeQualificationRejected) {
    throw new Error("An employee viewed another employee's qualification detail");
  }
  const luisOwnDetail = await getQualificationDetailForEmployee(
    secondEmployeeContext,
    luisQualification.id,
  );
  if (luisOwnDetail.id !== luisQualification.id || luisOwnDetail.supportingSessions.length !== 2) {
    throw new Error("An employee could not view their own qualification detail");
  }

  // Revocation: permanent, rejects a second attempt, and its history remains readable.
  let unauthorizedRevokeRejected = false;
  try {
    await revokeQualification(
      riversideManagerContext,
      samQualification.id,
      "",
      "verify-phase11-revoke-unauthorized-rejected",
    );
  } catch {
    unauthorizedRevokeRejected = true;
  }
  if (!unauthorizedRevokeRejected) {
    throw new Error("A manager without access to the location revoked a qualification");
  }

  const revokeNote = "Employee transferred to a different role.";
  const revoked = await revokeQualification(
    managerContext,
    samQualification.id,
    revokeNote,
    "verify-phase11-revoke",
  );
  if (
    revoked.status !== "revoked" ||
    revoked.revokedNote !== revokeNote ||
    revoked.revokedByManagerUserId !== managerContext.managerUserId
  ) {
    throw new Error(
      "Revoking a qualification did not persist its status, note, and revoking manager",
    );
  }

  let doubleQualificationRevokeRejected = false;
  try {
    await revokeQualification(
      managerContext,
      samQualification.id,
      "",
      "verify-phase11-revoke-double-rejected",
    );
  } catch {
    doubleQualificationRevokeRejected = true;
  }
  if (!doubleQualificationRevokeRejected) {
    throw new Error("An already-revoked qualification was revoked a second time");
  }

  const revokedHistory = await getQualificationDetail(managerContext, samQualification.id);
  if (revokedHistory.status !== "revoked" || revokedHistory.canRevoke) {
    throw new Error(
      "A revoked qualification's history was not readable, or it falsely reported as revocable",
    );
  }
  const overviewAfterRevoke = await listQualificationsOverview(managerContext, {
    locationId: seedIds.locations.downtown,
    tab: "",
  });
  const samRowAfterRevoke = overviewAfterRevoke.find(
    (row) =>
      row.employeeId === expiringSoonEmployee.id && row.definitionId === grillPath.definition.id,
  );
  if (!samRowAfterRevoke || samRowAfterRevoke.classification !== "missing") {
    throw new Error("The overview did not reclassify a revoked employee as missing");
  }

  // Archiving a path (status: disabled) disables its 1:1 definition too, and stops the award
  // algorithm from ever awarding it again, even when every required item still passes.
  const archivedPath = await updatePath(
    managerContext,
    grillPath.id,
    {
      title: grillPath.title,
      description: grillPath.description,
      enforceOrder: grillPath.enforceOrder,
      status: "disabled",
      definition: {
        name: grillPath.definition.name,
        description: grillPath.definition.description,
        defaultValidityDays: grillPath.definition.defaultValidityDays,
      },
      items: grillPath.items.map((item) => ({
        sopId: item.sopId,
        isRequired: item.isRequired,
        versionPolicy: item.versionPolicy,
      })),
    },
    "verify-phase11-path-archive",
  );
  if (archivedPath.status !== "disabled" || archivedPath.definition.status !== "disabled") {
    throw new Error("Archiving a training path did not disable it and its 1:1 definition together");
  }

  const archivedEmployee = await createEmployee(managerContext, {
    primaryLocationId: seedIds.locations.downtown,
    employeeNumber: "9104",
    displayName: "Devon Archived",
    jobRole: "Cook",
    language: "en",
    pin: "9104",
    status: "active",
  });
  const archivedAssignA = await assignTraining(
    managerContext,
    { sopId: pathSopA.id, target: { type: "employees", employeeIds: [archivedEmployee.id] } },
    "verify-phase11-archived-assign-a",
  );
  const archivedAssignB = await assignTraining(
    managerContext,
    { sopId: pathSopB.id, target: { type: "employees", employeeIds: [archivedEmployee.id] } },
    "verify-phase11-archived-assign-b",
  );
  const archivedAssignmentA = archivedAssignA.created[0];
  const archivedAssignmentB = archivedAssignB.created[0];
  if (!archivedAssignmentA || !archivedAssignmentB) {
    throw new Error("The archived-path Phase 11 fixture assignments were not created");
  }
  const devonContext = await loginNewEmployee("9104", "9104", "phase11-devon");
  await completeMinimalAssignment(
    devonContext,
    archivedAssignmentA.id,
    "verify-phase11-archived-complete-a",
  );
  await completeMinimalAssignment(
    devonContext,
    archivedAssignmentB.id,
    "verify-phase11-archived-complete-b",
  );
  const devonQualifications = await getDb()
    .select()
    .from(employeeQualifications)
    .where(eq(employeeQualifications.employeeId, archivedEmployee.id));
  if (devonQualifications.length !== 0) {
    throw new Error(
      "Completing every required item on an archived path still awarded a qualification",
    );
  }

  // --- Phase 12: checklists as a separate aggregate ---

  let unauthorizedChecklistCreateRejected = false;
  try {
    await createChecklist(
      riversideManagerContext,
      {
        title: "Closing Checklist",
        description: "",
        type: "closing",
        recurrenceType: "daily",
        status: "active",
        locationId: seedIds.locations.downtown,
        stationId: null,
        items: [
          {
            title: "Lock the doors",
            instructions: "",
            isRequired: true,
            timerSeconds: null,
            requirePhoto: false,
            requireApproval: false,
            requireNote: false,
            referenceFileId: null,
          },
        ],
      },
      "verify-phase12-checklist-create-unauthorized-rejected",
    );
  } catch {
    unauthorizedChecklistCreateRejected = true;
  }
  if (!unauthorizedChecklistCreateRejected) {
    throw new Error("A manager without access to the location created a checklist");
  }

  const closingChecklist = await createChecklist(
    managerContext,
    {
      title: "Closing Checklist",
      description: "End of day closing tasks.",
      type: "closing",
      recurrenceType: "daily",
      status: "active",
      locationId: seedIds.locations.downtown,
      stationId: null,
      items: [
        {
          title: "Empty all trash",
          instructions: "",
          isRequired: true,
          timerSeconds: null,
          requirePhoto: false,
          requireApproval: false,
          requireNote: false,
          referenceFileId: null,
        },
        {
          title: "Sanitize the grill",
          instructions: "Contact time matters.",
          isRequired: true,
          timerSeconds: 60,
          requirePhoto: false,
          requireApproval: false,
          requireNote: false,
          referenceFileId: null,
        },
        {
          title: "Submit closing photo",
          instructions: "",
          isRequired: true,
          timerSeconds: null,
          requirePhoto: true,
          requireApproval: true,
          requireNote: false,
          referenceFileId: null,
        },
        {
          title: "Leave a shift note",
          instructions: "",
          isRequired: true,
          timerSeconds: null,
          requirePhoto: false,
          requireApproval: false,
          requireNote: true,
          referenceFileId: null,
        },
      ],
    },
    "verify-phase12-checklist-create",
  );
  if (closingChecklist.items.length !== 4) {
    throw new Error("Checklist creation did not persist every item");
  }
  const [tickItem, timerItem, photoItem, noteItem] = closingChecklist.items;
  if (!tickItem || !timerItem || !photoItem || !noteItem) {
    throw new Error("Checklist creation did not return every item in order");
  }

  let duplicateChecklistTitleRejected = false;
  try {
    await createChecklist(
      managerContext,
      {
        title: "Closing Checklist",
        description: "",
        type: "closing",
        recurrenceType: "once",
        status: "active",
        locationId: seedIds.locations.downtown,
        stationId: null,
        items: [
          {
            title: "Item",
            instructions: "",
            isRequired: true,
            timerSeconds: null,
            requirePhoto: false,
            requireApproval: false,
            requireNote: false,
            referenceFileId: null,
          },
        ],
      },
      "verify-phase12-checklist-duplicate-title-rejected",
    );
  } catch {
    duplicateChecklistTitleRejected = true;
  }
  if (!duplicateChecklistTitleRejected) {
    throw new Error("A duplicate checklist title at the same location was accepted");
  }

  const checklistEmployee = await createEmployee(managerContext, {
    primaryLocationId: seedIds.locations.downtown,
    employeeNumber: "9201",
    displayName: "Riley Checklist",
    jobRole: "Cook",
    language: "en",
    pin: "9201",
    status: "active",
  });
  const rileyContext = await loginNewEmployee("9201", "9201", "phase12-riley");
  if (checklistEmployee.primaryLocationId !== seedIds.locations.downtown) {
    throw new Error(
      "The Phase 12 checklist employee fixture was not created at the expected location",
    );
  }

  const checklistDetailForManager = await getChecklistDetail(managerContext, closingChecklist.id);
  if (checklistDetailForManager.items.length !== 4) {
    throw new Error("Reading a checklist's detail did not return its active items");
  }
  const checklistForEmployee = await getChecklistForEmployee(rileyContext, closingChecklist.id);
  if (checklistForEmployee.items.length !== 4) {
    throw new Error("The employee-facing checklist read did not return its active items");
  }

  const startedRun = await startOrResumeRun(
    rileyContext,
    closingChecklist.id,
    "verify-phase12-run-start",
  );
  if (startedRun.items.length !== 4 || startedRun.items.some((item) => item.isDone)) {
    throw new Error("Starting a checklist run did not create fresh pending progress");
  }
  const resumedRun = await startOrResumeRun(
    rileyContext,
    closingChecklist.id,
    "verify-phase12-run-resume",
  );
  if (resumedRun.id !== startedRun.id) {
    throw new Error("Resuming an in-progress checklist run created a second run instead");
  }

  let plainTickOnAutoItemRejected = false;
  try {
    await recordItemAction(
      rileyContext,
      startedRun.id,
      timerItem.id,
      { action: "ticked", expectedRevision: resumedRun.revision },
      "verify-phase12-tick-timer-item-rejected",
    );
  } catch {
    plainTickOnAutoItemRejected = true;
  }
  if (!plainTickOnAutoItemRejected) {
    throw new Error("A manual tick action was accepted on an item with an automatic requirement");
  }

  const afterTick = await recordItemAction(
    rileyContext,
    startedRun.id,
    tickItem.id,
    { action: "ticked", expectedRevision: resumedRun.revision },
    "verify-phase12-tick",
  );
  if (!afterTick.items.find((item) => item.id === tickItem.id)?.isDone) {
    throw new Error("Ticking a plain checklist item did not mark it done");
  }

  const afterTimerItem = await recordItemAction(
    rileyContext,
    startedRun.id,
    timerItem.id,
    { action: "timer_completed", expectedRevision: afterTick.revision },
    "verify-phase12-timer-complete",
  );
  if (!afterTimerItem.items.find((item) => item.id === timerItem.id)?.isDone) {
    throw new Error("Completing a checklist item's timer did not mark it done");
  }

  let checklistPrematureSubmitRejected = false;
  try {
    await submitChecklistRun(
      rileyContext,
      startedRun.id,
      afterTimerItem.revision,
      "verify-phase12-premature-submit-rejected",
    );
  } catch {
    checklistPrematureSubmitRejected = true;
  }
  if (!checklistPrematureSubmitRejected) {
    throw new Error("Submitting a checklist run with incomplete required items was accepted");
  }

  const smallPngForChecklist = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  let evidenceOnNonPhotoItemRejected = false;
  try {
    const wrongItemForm = new FormData();
    wrongItemForm.set(
      "file",
      new File([new Uint8Array(smallPngForChecklist)], "wrong-item.png", { type: "image/png" }),
    );
    await submitItemEvidence(
      rileyContext,
      startedRun.id,
      tickItem.id,
      wrongItemForm,
      { employeeNote: "", expectedRevision: afterTimerItem.revision },
      "verify-phase12-evidence-wrong-item-rejected",
    );
  } catch {
    evidenceOnNonPhotoItemRejected = true;
  }
  if (!evidenceOnNonPhotoItemRejected) {
    throw new Error("Photo evidence was accepted for a checklist item that does not require one");
  }

  const photoForm = new FormData();
  photoForm.set(
    "file",
    new File([new Uint8Array(smallPngForChecklist)], "closing.png", { type: "image/png" }),
  );
  const afterPhoto = await submitItemEvidence(
    rileyContext,
    startedRun.id,
    photoItem.id,
    photoForm,
    { employeeNote: "Grill area clean", expectedRevision: afterTimerItem.revision },
    "verify-phase12-evidence-upload",
  );
  if (!afterPhoto.items.find((item) => item.id === photoItem.id)?.isDone) {
    throw new Error("Uploading required photo evidence did not mark the checklist item done");
  }

  const afterNote = await saveItemNote(
    rileyContext,
    startedRun.id,
    noteItem.id,
    {
      employeeNote: "Fryer oil changed, all stations restocked.",
      expectedRevision: afterPhoto.revision,
    },
    "verify-phase12-note-save",
  );
  if (!afterNote.items.find((item) => item.id === noteItem.id)?.isDone) {
    throw new Error("Saving a required checklist item note did not mark it done");
  }

  const submittedRun = await submitChecklistRun(
    rileyContext,
    startedRun.id,
    afterNote.revision,
    "verify-phase12-submit",
  );
  if (submittedRun.status !== "awaiting_approval") {
    throw new Error(
      "Submitting a checklist run with an approval-required item did not route for review",
    );
  }

  let duplicateOccurrenceWhileAwaitingRejected = false;
  try {
    await startOrResumeRun(
      rileyContext,
      closingChecklist.id,
      "verify-phase12-duplicate-occurrence-awaiting-rejected",
    );
  } catch {
    duplicateOccurrenceWhileAwaitingRejected = true;
  }
  if (!duplicateOccurrenceWhileAwaitingRejected) {
    throw new Error(
      "A second checklist run was started for the same day while one was awaiting review",
    );
  }

  let unauthorizedDecideRejected = false;
  try {
    await decideChecklistRun(
      riversideManagerContext,
      submittedRun.id,
      { decision: "approved", note: "" },
      "verify-phase12-decide-unauthorized-rejected",
    );
  } catch {
    unauthorizedDecideRejected = true;
  }
  if (!unauthorizedDecideRejected) {
    throw new Error("A manager without access to the location decided a checklist run");
  }

  await decideChecklistRun(
    scopedManagerContext,
    submittedRun.id,
    { decision: "needs_correction", note: "The closing photo is blurry, retake it." },
    "verify-phase12-decide-needs-correction",
  );
  const afterChecklistCorrectionRequest = await getChecklistRunDetail(
    scopedManagerContext,
    submittedRun.id,
  );
  if (
    afterChecklistCorrectionRequest.status !== "awaiting_approval" ||
    afterChecklistCorrectionRequest.submission?.status !== "needs_correction"
  ) {
    throw new Error("Requesting a checklist correction did not leave the run awaiting review");
  }

  const replacementPhotoForm = new FormData();
  replacementPhotoForm.set(
    "file",
    new File([new Uint8Array(smallPngForChecklist)], "closing-retake.png", { type: "image/png" }),
  );
  const afterChecklistResubmit = await submitItemEvidence(
    rileyContext,
    startedRun.id,
    photoItem.id,
    replacementPhotoForm,
    { employeeNote: "Retaken, in focus", expectedRevision: submittedRun.revision },
    "verify-phase12-correction-resubmit",
  );
  if (afterChecklistResubmit.status !== "awaiting_approval") {
    throw new Error("Resubmitting a checklist correction changed the run out of review");
  }
  const resubmittedPhotoItem = afterChecklistResubmit.items.find(
    (item) => item.id === photoItem.id,
  );
  if (!resubmittedPhotoItem || resubmittedPhotoItem.evidence.length !== 2) {
    throw new Error("Correction resubmission did not append replacement evidence");
  }

  let duplicateChecklistResubmitRejected = false;
  try {
    const secondReplacementForm = new FormData();
    secondReplacementForm.set(
      "file",
      new File([new Uint8Array(smallPngForChecklist)], "closing-again.png", { type: "image/png" }),
    );
    await submitItemEvidence(
      rileyContext,
      startedRun.id,
      photoItem.id,
      secondReplacementForm,
      { employeeNote: "", expectedRevision: afterChecklistResubmit.revision },
      "verify-phase12-duplicate-resubmit-rejected",
    );
  } catch {
    duplicateChecklistResubmitRejected = true;
  }
  if (!duplicateChecklistResubmitRejected) {
    throw new Error("A checklist correction was resubmitted twice for the same decision");
  }

  const approvedRunDetail = await decideChecklistRun(
    scopedManagerContext,
    submittedRun.id,
    { decision: "approved", note: "" },
    "verify-phase12-decide-approved",
  );
  if (approvedRunDetail.status !== "submitted" || approvedRunDetail.submissions.length !== 2) {
    throw new Error(
      "Approving a resubmitted checklist run did not complete it with both generations retained",
    );
  }

  const idempotentSubmit = await submitChecklistRun(
    rileyContext,
    startedRun.id,
    999,
    "verify-phase12-idempotent-submit",
  );
  if (idempotentSubmit.status !== "submitted") {
    throw new Error("Resubmitting an already-submitted checklist run was not idempotent");
  }

  let duplicateOccurrenceAfterSubmitRejected = false;
  try {
    await startOrResumeRun(
      rileyContext,
      closingChecklist.id,
      "verify-phase12-duplicate-occurrence-submitted-rejected",
    );
  } catch {
    duplicateOccurrenceAfterSubmitRejected = true;
  }
  if (!duplicateOccurrenceAfterSubmitRejected) {
    throw new Error("A second checklist run was started for the same day after one was submitted");
  }

  const riversideChecklists = await listChecklists(riversideManagerContext, {
    locationId: "",
    status: "",
    type: "",
  });
  if (riversideChecklists.some((row) => row.id === closingChecklist.id)) {
    throw new Error("A manager without access to the location could see its checklist");
  }
  const riversideRuns = await listChecklistRuns(riversideManagerContext, {
    locationId: "",
    status: "",
  });
  if (riversideRuns.some((row) => row.id === startedRun.id)) {
    throw new Error("A manager without access to the location could see its checklist run");
  }
  const submittedRunsForOwner = await listChecklistRuns(managerContext, {
    locationId: "",
    status: "submitted",
  });
  if (!submittedRunsForOwner.some((row) => row.id === startedRun.id)) {
    throw new Error("The submitted checklist run did not appear in the owner's run list");
  }

  const updatedChecklist = await updateChecklist(
    managerContext,
    closingChecklist.id,
    {
      title: closingChecklist.title,
      description: closingChecklist.description,
      type: closingChecklist.type,
      recurrenceType: closingChecklist.recurrenceType,
      status: closingChecklist.status,
      items: [
        {
          id: tickItem.id,
          title: tickItem.title,
          instructions: tickItem.instructions,
          isRequired: tickItem.isRequired,
          timerSeconds: tickItem.timerSeconds,
          requirePhoto: tickItem.requirePhoto,
          requireApproval: tickItem.requireApproval,
          requireNote: tickItem.requireNote,
          referenceFileId: tickItem.referenceFileId,
        },
        {
          id: timerItem.id,
          title: timerItem.title,
          instructions: timerItem.instructions,
          isRequired: timerItem.isRequired,
          timerSeconds: timerItem.timerSeconds,
          requirePhoto: timerItem.requirePhoto,
          requireApproval: timerItem.requireApproval,
          requireNote: timerItem.requireNote,
          referenceFileId: timerItem.referenceFileId,
        },
        {
          id: noteItem.id,
          title: noteItem.title,
          instructions: noteItem.instructions,
          isRequired: noteItem.isRequired,
          timerSeconds: noteItem.timerSeconds,
          requirePhoto: noteItem.requirePhoto,
          requireApproval: noteItem.requireApproval,
          requireNote: noteItem.requireNote,
          referenceFileId: noteItem.referenceFileId,
        },
      ],
    },
    "verify-phase12-checklist-update-remove-item",
  );
  if (updatedChecklist.items.length !== 3) {
    throw new Error("Editing a checklist did not reconcile its item list");
  }
  const disabledPhotoItem = await getDb()
    .select()
    .from(checklistItems)
    .where(eq(checklistItems.id, photoItem.id))
    .limit(1);
  if (disabledPhotoItem[0]?.status !== "disabled") {
    throw new Error(
      "Removing an item with existing run history deleted it instead of disabling it",
    );
  }
  const runDetailAfterItemRemoval = await getChecklistRunDetail(managerContext, startedRun.id);
  if (!runDetailAfterItemRemoval.items.some((item) => item.id === photoItem.id)) {
    throw new Error(
      "A historical checklist run lost an item after it was removed from the definition",
    );
  }

  // --- Phase 13: manual translations (English source, Spanish target) ---

  const translationDraft = await createSop(
    managerContext,
    {
      title: "Simple Syrup",
      description: "A basic 1:1 sugar syrup for the bar.",
      category: "recipe",
      locationId: seedIds.locations.downtown,
      stationId: null,
      estimatedMinutes: 10,
      difficulty: "beginner",
      coverImageFileId: null,
      sourceVideoFileId: null,
      materials: [
        { kind: "ingredient", name: "Granulated sugar", quantity: "2", unit: "cups" },
        { kind: "ingredient", name: "Water", quantity: "2", unit: "cups" },
      ],
      warnings: [{ text: "Hot liquid — handle with care." }],
    },
    "verify-phase13-sop-create",
  );
  const translationStepDraft = await createStep(
    managerContext,
    translationDraft.id,
    {
      title: "Combine and heat",
      instruction: "Combine sugar and water in a saucepan over medium heat until dissolved.",
      imageFileId: null,
      videoFileId: null,
      warning: "Do not leave the stove unattended.",
      quantity: "2",
      unit: "cups",
      equipmentSetting: "Medium heat",
      timerSeconds: 300,
      isRequired: true,
      expectedRevision: translationDraft.version.revision,
    },
    "verify-phase13-step-create",
  );
  const translationPublished = await publishSop(
    managerContext,
    translationDraft.id,
    {
      expectedRevision: translationStepDraft.version.revision,
      changeSummary: "",
      retrainingRule: { type: "none" },
    },
    "verify-phase13-publish",
  );
  if (translationPublished.status !== "published" || !translationPublished.currentVersionId) {
    throw new Error("Publishing the Phase 13 translation fixture SOP did not succeed");
  }

  const initialTranslationMatrix = await getTranslationMatrix(
    managerContext,
    translationPublished.id,
    "es",
  );
  // Title, description, 2 material names, 1 warning, step title, step instruction, step warning.
  // Quantities, units, the equipment setting, and the timer are protected measurements and must
  // never appear here.
  if (initialTranslationMatrix.rows.length !== 8) {
    throw new Error(
      `The Phase 13 translation matrix did not include exactly the translatable fields (got ${initialTranslationMatrix.rows.length})`,
    );
  }
  if (initialTranslationMatrix.rows.some((row) => row.status !== "untranslated" || row.stale)) {
    throw new Error(
      "The Phase 13 translation matrix reported a status before any translation was entered",
    );
  }

  let unauthorizedMatrixReadRejected = false;
  try {
    await getTranslationMatrix(riversideManagerContext, translationPublished.id, "es");
  } catch {
    unauthorizedMatrixReadRejected = true;
  }
  if (!unauthorizedMatrixReadRejected) {
    throw new Error(
      "A manager without access to the location read another location's translations",
    );
  }

  let crossEntityUpsertRejected = false;
  try {
    await upsertTranslation(
      managerContext,
      translationPublished.id,
      {
        entityType: "sop_step",
        entityId: randomUUID(),
        field: "instruction",
        targetLocale: "es",
        translatedText: "No debería guardarse.",
      },
      "verify-phase13-cross-entity-rejected",
    );
  } catch {
    crossEntityUpsertRejected = true;
  }
  if (!crossEntityUpsertRejected) {
    throw new Error("A translation was saved for an entity id outside the SOP's current version");
  }

  const versionTitleField = initialTranslationMatrix.rows.find(
    (row) => row.entityType === "sop_version" && row.field === "title",
  );
  const versionDescriptionField = initialTranslationMatrix.rows.find(
    (row) => row.entityType === "sop_version" && row.field === "description",
  );
  if (!versionTitleField || !versionDescriptionField) {
    throw new Error("The Phase 13 translation matrix was missing a version-level field");
  }

  const afterTitleSave = await upsertTranslation(
    managerContext,
    translationPublished.id,
    {
      entityType: "sop_version",
      entityId: versionTitleField.entityId,
      field: "title",
      targetLocale: "es",
      translatedText: "Jarabe simple",
    },
    "verify-phase13-upsert-title",
  );
  const savedTitleRow = afterTitleSave.rows.find(
    (row) => row.entityType === "sop_version" && row.field === "title",
  );
  if (!savedTitleRow || savedTitleRow.status !== "pending_review" || !savedTitleRow.translationId) {
    throw new Error("Saving a translation did not move it to pending review");
  }

  const afterEmptyDescriptionSave = await upsertTranslation(
    managerContext,
    translationPublished.id,
    {
      entityType: "sop_version",
      entityId: versionDescriptionField.entityId,
      field: "description",
      targetLocale: "es",
      translatedText: "",
    },
    "verify-phase13-empty-description-save",
  );
  const emptyDescriptionRow = afterEmptyDescriptionSave.rows.find(
    (row) => row.entityType === "sop_version" && row.field === "description",
  );
  if (!emptyDescriptionRow || !emptyDescriptionRow.translationId) {
    throw new Error("An empty translation draft was not saved");
  }

  let approveEmptyRejected = false;
  try {
    await approveTranslation(
      managerContext,
      translationPublished.id,
      emptyDescriptionRow.translationId,
      "verify-phase13-approve-empty-rejected",
    );
  } catch {
    approveEmptyRejected = true;
  }
  if (!approveEmptyRejected) {
    throw new Error("An empty translation was approved");
  }

  const afterTitleApprove = await approveTranslation(
    managerContext,
    translationPublished.id,
    savedTitleRow.translationId,
    "verify-phase13-approve-title",
  );
  const approvedTitleRow = afterTitleApprove.rows.find(
    (row) => row.entityType === "sop_version" && row.field === "title",
  );
  if (!approvedTitleRow || approvedTitleRow.status !== "approved" || !approvedTitleRow.approvedAt) {
    throw new Error("Approving a translation did not record its approval");
  }

  let unauthorizedApproveRejected = false;
  try {
    await approveTranslation(
      riversideManagerContext,
      translationPublished.id,
      savedTitleRow.translationId,
      "verify-phase13-unauthorized-approve-rejected",
    );
  } catch {
    unauthorizedApproveRejected = true;
  }
  if (!unauthorizedApproveRejected) {
    throw new Error("A manager without access to the location approved a translation");
  }

  const afterTitleReEdit = await upsertTranslation(
    managerContext,
    translationPublished.id,
    {
      entityType: "sop_version",
      entityId: versionTitleField.entityId,
      field: "title",
      targetLocale: "es",
      translatedText: "Jarabe simple (actualizado)",
    },
    "verify-phase13-re-edit-approved",
  );
  const reEditedTitleRow = afterTitleReEdit.rows.find(
    (row) => row.entityType === "sop_version" && row.field === "title",
  );
  if (
    !reEditedTitleRow ||
    reEditedTitleRow.status !== "pending_review" ||
    reEditedTitleRow.approvedAt
  ) {
    throw new Error("Editing an approved translation did not require fresh review");
  }

  const afterTitleReApprove = await approveTranslation(
    managerContext,
    translationPublished.id,
    savedTitleRow.translationId,
    "verify-phase13-re-approve-title",
  );
  const reApprovedTitleRow = afterTitleReApprove.rows.find(
    (row) => row.entityType === "sop_version" && row.field === "title",
  );
  if (!reApprovedTitleRow || reApprovedTitleRow.status !== "approved") {
    throw new Error("Re-approving an edited translation did not succeed");
  }

  const translationEmployee = await createEmployee(managerContext, {
    primaryLocationId: seedIds.locations.downtown,
    employeeNumber: "9301",
    displayName: "Casey Bilingual",
    jobRole: "Bartender",
    language: "es",
    pin: "9301",
    status: "active",
  });
  const caseyContext = await loginNewEmployee("9301", "9301", "phase13-casey");
  if (translationEmployee.primaryLocationId !== seedIds.locations.downtown) {
    throw new Error(
      "The Phase 13 translation employee fixture was not created at the expected location",
    );
  }

  const englishEmployeeView = await getLocalizedSopForEmployee(
    caseyContext,
    translationPublished.id,
    "en",
  );
  if (
    englishEmployeeView.version.title.text !== "Simple Syrup" ||
    englishEmployeeView.version.title.translated
  ) {
    throw new Error("Requesting the English SOP view returned translated content");
  }

  const spanishEmployeeView = await getLocalizedSopForEmployee(
    caseyContext,
    translationPublished.id,
    "es",
  );
  if (
    spanishEmployeeView.version.title.text !== "Jarabe simple (actualizado)" ||
    !spanishEmployeeView.version.title.translated
  ) {
    throw new Error("The approved Spanish title translation was not applied for the employee view");
  }
  if (
    spanishEmployeeView.version.description.text !== "A basic 1:1 sugar syrup for the bar." ||
    spanishEmployeeView.version.description.translated
  ) {
    throw new Error(
      "An unapproved translation was shown to the employee instead of the original text",
    );
  }
  const spanishStep = spanishEmployeeView.steps[0];
  if (
    !spanishStep ||
    spanishStep.quantity !== "2" ||
    spanishStep.unit !== "cups" ||
    spanishStep.equipmentSetting !== "Medium heat" ||
    spanishStep.timerSeconds !== 300
  ) {
    throw new Error("Switching locale altered a protected measurement field");
  }
  const spanishMaterial = spanishEmployeeView.materials[0];
  if (!spanishMaterial || spanishMaterial.quantity !== "2" || spanishMaterial.unit !== "cups") {
    throw new Error("Switching locale altered a protected material measurement");
  }

  await getDb()
    .update(translationsTable)
    .set({ sourceTextHash: "stale-hash-for-verification" })
    .where(eq(translationsTable.id, savedTitleRow.translationId));
  const staleMatrix = await getTranslationMatrix(managerContext, translationPublished.id, "es");
  const staleTitleRow = staleMatrix.rows.find(
    (row) => row.translationId === savedTitleRow.translationId,
  );
  if (!staleTitleRow || !staleTitleRow.stale) {
    throw new Error("A translation with a mismatched source hash was not flagged as stale");
  }
  let approveStaleRejected = false;
  try {
    await approveTranslation(
      managerContext,
      translationPublished.id,
      savedTitleRow.translationId,
      "verify-phase13-approve-stale-rejected",
    );
  } catch {
    approveStaleRejected = true;
  }
  if (!approveStaleRejected) {
    throw new Error("A stale translation was approved without being re-saved");
  }

  const actions = new Set(
    (await getDb().select({ action: auditEvents.action }).from(auditEvents)).map(
      (event) => event.action,
    ),
  );
  const requiredAuditActions = [
    "manager.login",
    "employee.login",
    "login.failed",
    "manager.role_changed",
    "employee.pin_reset",
    "account.disabled",
    "access.unauthorized",
    "manager.password_reset_completed",
    "organization.updated",
    "location.created",
    "location.disabled",
    "station.created",
    "employee.created",
    "manager.locations_updated",
    "sop.created",
    "sop.updated",
    "sop.step_deleted",
    "sop.archived",
    "sop.previewed",
    "sop.published",
    "sop.draft_created",
    "sop.version_restored",
    "media.uploaded",
    "sop.viewed",
    "qr.created",
    "qr.revoked",
    "qr.rotated",
    "training.assigned",
    "training.session_started",
    "training.session_resumed",
    "training.step_progress_recorded",
    "training.answer_submitted",
    "training.evidence_submitted",
    "training.session_submitted",
    "training.approval_decided",
    "training.correction_requested",
    "training.correction_resubmitted",
    "training_path.created",
    "training_path.updated",
    "qualification.awarded",
    "qualification.revoked",
    "checklist.created",
    "checklist.updated",
    "checklist_run.started",
    "checklist_run.resumed",
    "checklist_run.item_progress_recorded",
    "checklist_run.evidence_submitted",
    "checklist_run.submitted",
    "checklist_run.approval_decided",
    "checklist_run.correction_requested",
    "checklist_run.correction_resubmitted",
    "translation.updated",
    "translation.approved",
  ];
  if (requiredAuditActions.some((action) => !actions.has(action))) {
    throw new Error(
      `Missing required audit actions: ${requiredAuditActions.filter((action) => !actions.has(action)).join(", ")}`,
    );
  }

  // --- Phase 14: aggregates, paginated reports, and activity history from real domain events ---
  // Every fixture above already exercised every mutation `writeDomainEvent` is wired into (SOP
  // publish/archive, bulk assignment, session completion, training/checklist approval decisions,
  // qualification award/revoke, checklist creation/run submission, translation approval), so this
  // section proves the resulting `domain_events` rows and the report/activity reads over them
  // rather than re-deriving new fixtures for each one.

  const domainEventTotalRows = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(domainEvents)
    .where(eq(domainEvents.organizationId, seedIds.organization));
  const domainEventTotal = domainEventTotalRows[0]?.count ?? 0;
  // A single generously-sized page covers every event this run has produced (well under this
  // bound in practice) so type coverage and the reported total can both be checked against it.
  const ownerActivityAll = await listActivity(managerContext, {
    page: 1,
    pageSize: Math.max(domainEventTotal, 1),
  });
  const observedActivityTypes = new Set(ownerActivityAll.items.map((item) => item.type));
  const missingActivityTypes = domainEventTypeValues.filter(
    (type) => !observedActivityTypes.has(type),
  );
  if (missingActivityTypes.length > 0) {
    throw new Error(
      `Missing domain event types in activity feed: ${missingActivityTypes.join(", ")}`,
    );
  }
  if (ownerActivityAll.total !== domainEventTotal) {
    throw new Error(
      `Owner activity total (${ownerActivityAll.total}) did not match the actual domain_events row count (${domainEventTotal})`,
    );
  }
  if (ownerActivityAll.items.length !== domainEventTotal) {
    throw new Error("Owner activity page did not return every domain event within its bound");
  }
  // Pagination distinctness: a small page size guarantees at least two pages given >= 11 event
  // types, and no id may appear on both.
  const activityPage1 = await listActivity(managerContext, { page: 1, pageSize: 2 });
  const activityPage2 = await listActivity(managerContext, { page: 2, pageSize: 2 });
  const activityPage1Ids = new Set(activityPage1.items.map((item) => item.id));
  if (activityPage2.items.some((item) => activityPage1Ids.has(item.id))) {
    throw new Error("Activity pagination returned overlapping rows across pages");
  }

  const scopedActivity = await listActivity(scopedManagerContext, { page: 1, pageSize: 100 });
  if (scopedActivity.items.some((item) => item.locationId !== seedIds.locations.downtown)) {
    throw new Error("A location-scoped manager saw an activity event outside their location");
  }
  const scopedActivityOtherLocation = await listActivity(scopedManagerContext, {
    locationId: seedIds.locations.riverside,
    page: 1,
    pageSize: 20,
  });
  if (scopedActivityOtherLocation.items.length !== 0 || scopedActivityOtherLocation.total !== 0) {
    throw new Error("A location-scoped manager was not empty-stated for an unmanaged location");
  }

  const publishedActivity = await listActivity(managerContext, {
    type: "sop.published",
    page: 1,
    pageSize: 50,
  });
  if (
    publishedActivity.total === 0 ||
    publishedActivity.items.some((item) => item.type !== "sop.published")
  ) {
    throw new Error("Activity type filter did not narrow to sop.published events");
  }

  // Training progress report
  const trainingReportPage = await getTrainingProgressReport(managerContext, {
    status: "",
    locationId: "",
    search: "",
    page: 1,
    pageSize: 5,
  });
  if (trainingReportPage.total === 0 || trainingReportPage.items.length === 0) {
    throw new Error("Training progress report returned no rows despite prior fixtures");
  }
  const firstTrainingRow = trainingReportPage.items[0];
  if (!firstTrainingRow) throw new Error("Training progress report page was unexpectedly empty");
  const trainingReportByStatus = await getTrainingProgressReport(managerContext, {
    status: firstTrainingRow.status,
    locationId: "",
    search: "",
    page: 1,
    pageSize: 100,
  });
  if (
    trainingReportByStatus.items.some((row) => row.status !== firstTrainingRow.status) ||
    !trainingReportByStatus.items.some((row) => row.id === firstTrainingRow.id)
  ) {
    throw new Error("Training progress report status filter did not behave correctly");
  }
  const trainingReportBySearch = await getTrainingProgressReport(managerContext, {
    status: "",
    locationId: "",
    search: firstTrainingRow.employeeName,
    page: 1,
    pageSize: 100,
  });
  if (!trainingReportBySearch.items.some((row) => row.id === firstTrainingRow.id)) {
    throw new Error("Training progress report search did not find the searched employee");
  }
  const scopedTrainingReport = await getTrainingProgressReport(scopedManagerContext, {
    status: "",
    locationId: "",
    search: "",
    page: 1,
    pageSize: 100,
  });
  if (scopedTrainingReport.items.some((row) => row.locationId !== seedIds.locations.downtown)) {
    throw new Error("A location-scoped manager saw a training progress row outside their location");
  }

  // Qualifications report. The only Phase 11 qualification program (`grillPath`) was deliberately
  // archived by that phase's own "archiving stops awards" test, so — correctly — it no longer
  // appears in `listQualificationsOverview`'s active-program roster by this point in the file.
  // Build a small fresh active program here rather than depending on that now-archived fixture.
  const reportPathSop = await createMinimalPublishedSop(
    managerContext,
    "Phase 14 Report Fixture SOP",
    seedIds.locations.downtown,
    "verify-phase14-report-sop",
  );
  const reportPath = await createPath(
    managerContext,
    {
      title: "Phase 14 Report Path",
      description: "",
      locationId: seedIds.locations.downtown,
      stationId: null,
      enforceOrder: true,
      status: "active",
      definition: {
        name: "Phase 14 Report Qualification",
        description: "",
        defaultValidityDays: 90,
      },
      items: [{ sopId: reportPathSop.id, isRequired: true, versionPolicy: "current_version" }],
    },
    "verify-phase14-report-path-create",
  );
  const reportPathEmployee = await createEmployee(managerContext, {
    primaryLocationId: seedIds.locations.downtown,
    employeeNumber: "9105",
    displayName: "Riley Reportee",
    jobRole: "Cook",
    language: "en",
    pin: "9105",
    status: "active",
  });
  const reportPathAssign = await assignTraining(
    managerContext,
    {
      sopId: reportPathSop.id,
      target: { type: "employees", employeeIds: [reportPathEmployee.id] },
    },
    "verify-phase14-report-assign",
  );
  const reportPathAssignmentId = reportPathAssign.created[0]?.id;
  if (!reportPathAssignmentId) {
    throw new Error("The Phase 14 report fixture assignment was not created");
  }
  const reportPathEmployeeSession = await loginNewEmployee(
    "9105",
    "9105",
    "verify-phase14-report-employee",
  );
  await completeMinimalAssignment(
    reportPathEmployeeSession,
    reportPathAssignmentId,
    "verify-phase14-report-complete",
  );

  const qualificationsReportPage = await getQualificationsReport(managerContext, {
    locationId: "",
    tab: "",
    page: 1,
    pageSize: 5,
  });
  if (qualificationsReportPage.total === 0 || qualificationsReportPage.items.length === 0) {
    throw new Error("Qualifications report returned no rows despite prior fixtures");
  }
  // Every active-location employee is a row in this report, so the fresh fixture may not land on
  // a 5-row first page once sorted by name; fetch a page wide enough to find it deterministically.
  const qualificationsReportWide = await getQualificationsReport(managerContext, {
    locationId: "",
    tab: "",
    page: 1,
    pageSize: 200,
  });
  const firstQualificationRow = qualificationsReportWide.items.find(
    (row) =>
      row.definitionId === reportPath.definition.id && row.employeeId === reportPathEmployee.id,
  );
  if (!firstQualificationRow) {
    throw new Error("Qualifications report did not include the freshly awarded Phase 14 fixture");
  }
  const qualificationsReportByTab = await getQualificationsReport(managerContext, {
    locationId: "",
    tab: firstQualificationRow.classification,
    page: 1,
    pageSize: 200,
  });
  if (
    qualificationsReportByTab.items.some(
      (row) => row.classification !== firstQualificationRow.classification,
    )
  ) {
    throw new Error("Qualifications report tab filter did not behave correctly");
  }
  if (qualificationsReportPage.total > 1) {
    const qualificationsPage1 = await getQualificationsReport(managerContext, {
      locationId: "",
      tab: "",
      page: 1,
      pageSize: 1,
    });
    const qualificationsPage2 = await getQualificationsReport(managerContext, {
      locationId: "",
      tab: "",
      page: 2,
      pageSize: 1,
    });
    // Compare by employee+definition rather than `qualificationId` alone: a "missing" candidate
    // row legitimately has a null `qualificationId`, and every row here shares the same
    // `definitionId` since the fixture above is the only active program in this run.
    if (
      qualificationsPage1.items[0]?.employeeId === qualificationsPage2.items[0]?.employeeId &&
      qualificationsPage1.items[0]?.definitionId === qualificationsPage2.items[0]?.definitionId
    ) {
      throw new Error("Qualifications report pagination did not return distinct pages");
    }
  }

  // Checklist completion report
  const checklistReportPage = await getChecklistCompletionReport(managerContext, {
    status: "",
    locationId: "",
    search: "",
    page: 1,
    pageSize: 5,
  });
  if (checklistReportPage.total === 0 || checklistReportPage.items.length === 0) {
    throw new Error("Checklist completion report returned no rows despite prior fixtures");
  }
  const firstChecklistRow = checklistReportPage.items[0];
  if (!firstChecklistRow)
    throw new Error("Checklist completion report page was unexpectedly empty");
  const checklistReportByStatus = await getChecklistCompletionReport(managerContext, {
    status: firstChecklistRow.status,
    locationId: "",
    search: "",
    page: 1,
    pageSize: 100,
  });
  if (
    checklistReportByStatus.items.some((row) => row.status !== firstChecklistRow.status) ||
    !checklistReportByStatus.items.some((row) => row.id === firstChecklistRow.id)
  ) {
    throw new Error("Checklist completion report status filter did not behave correctly");
  }
  const scopedChecklistReport = await getChecklistCompletionReport(scopedManagerContext, {
    status: "",
    locationId: "",
    search: "",
    page: 1,
    pageSize: 100,
  });
  if (scopedChecklistReport.items.some((row) => row.locationId !== seedIds.locations.downtown)) {
    throw new Error(
      "A location-scoped manager saw a checklist completion row outside their location",
    );
  }

  // SOP version history report
  const sopVersionReportPage = await getSopVersionHistoryReport(managerContext, {
    search: "",
    category: "",
    status: "",
    locationId: "",
    page: 1,
    pageSize: 5,
  });
  if (sopVersionReportPage.total === 0 || sopVersionReportPage.items.length === 0) {
    throw new Error("SOP version history report returned no rows despite prior fixtures");
  }
  const firstSopVersionRow = sopVersionReportPage.items[0];
  if (!firstSopVersionRow)
    throw new Error("SOP version history report page was unexpectedly empty");
  const sopVersionReportByStatus = await getSopVersionHistoryReport(managerContext, {
    search: "",
    category: "",
    status: firstSopVersionRow.status,
    locationId: "",
    page: 1,
    pageSize: 200,
  });
  if (
    sopVersionReportByStatus.items.some((row) => row.status !== firstSopVersionRow.status) ||
    !sopVersionReportByStatus.items.some((row) => row.id === firstSopVersionRow.id)
  ) {
    throw new Error("SOP version history report status filter did not behave correctly");
  }
  const scopedSopVersionReport = await getSopVersionHistoryReport(scopedManagerContext, {
    search: "",
    category: "",
    status: "",
    locationId: "",
    page: 1,
    pageSize: 200,
  });
  if (scopedSopVersionReport.items.some((row) => row.locationId !== seedIds.locations.downtown)) {
    throw new Error(
      "A location-scoped manager saw a SOP version history row outside their location",
    );
  }

  // Approval decision history report (unions the separate training and checklist decision tables)
  const approvalHistoryPage = await getApprovalHistoryReport(managerContext, {
    locationId: "",
    decision: "",
    page: 1,
    pageSize: 100,
  });
  if (approvalHistoryPage.total === 0 || approvalHistoryPage.items.length === 0) {
    throw new Error("Approval history report returned no rows despite prior fixtures");
  }
  if (!approvalHistoryPage.items.some((row) => row.kind === "training")) {
    throw new Error("Approval history report is missing training decisions");
  }
  if (!approvalHistoryPage.items.some((row) => row.kind === "checklist")) {
    throw new Error("Approval history report is missing checklist decisions");
  }
  const firstApprovalRow = approvalHistoryPage.items[0];
  if (!firstApprovalRow) throw new Error("Approval history report page was unexpectedly empty");
  const approvalHistoryByDecision = await getApprovalHistoryReport(managerContext, {
    locationId: "",
    decision: firstApprovalRow.decision,
    page: 1,
    pageSize: 100,
  });
  if (approvalHistoryByDecision.items.some((row) => row.decision !== firstApprovalRow.decision)) {
    throw new Error("Approval history report decision filter did not behave correctly");
  }
  const scopedApprovalHistory = await getApprovalHistoryReport(scopedManagerContext, {
    locationId: "",
    decision: "",
    page: 1,
    pageSize: 200,
  });
  if (scopedApprovalHistory.items.some((row) => row.locationId !== seedIds.locations.downtown)) {
    throw new Error("A location-scoped manager saw an approval decision outside their location");
  }

  // --- Phase 15: permission-aware print, PDF, and CSV representations of versioned records ---
  // Reuses the exact report/fixture rows the Phase 14 block above just proved are correctly
  // scoped, so this section is free to focus on what's new: the print/PDF record readers, PDF
  // byte generation and text fidelity, and CSV row fidelity/injection safety.

  const publishedSopVersionPage = await getSopVersionHistoryReport(managerContext, {
    search: "",
    category: "",
    status: "published",
    locationId: "",
    page: 1,
    pageSize: 1,
  });
  const publishedSopVersionRow = publishedSopVersionPage.items[0];
  if (!publishedSopVersionRow) {
    throw new Error("No published SOP version was available for the Phase 15 print fixtures");
  }
  const sopPrintRecord = await getSopVersionForPrint(managerContext, publishedSopVersionRow.id);
  if (
    sopPrintRecord.version.id !== publishedSopVersionRow.id ||
    sopPrintRecord.steps.length === 0
  ) {
    throw new Error("SOP version print record did not match the published version's own content");
  }

  const draftSopVersionPage = await getSopVersionHistoryReport(managerContext, {
    search: "",
    category: "",
    status: "draft",
    locationId: "",
    page: 1,
    pageSize: 1,
  });
  const draftSopVersionRow = draftSopVersionPage.items[0];
  if (!draftSopVersionRow) {
    throw new Error("No draft SOP version was available for the Phase 15 draft-rejection check");
  }
  let draftSopPrintRejected = false;
  try {
    await getSopVersionForPrint(managerContext, draftSopVersionRow.id);
  } catch {
    draftSopPrintRejected = true;
  }
  if (!draftSopPrintRejected) throw new Error("A draft SOP version was incorrectly printable");

  let nonexistentSopPrintRejected = false;
  try {
    await getSopVersionForPrint(managerContext, randomUUID());
  } catch {
    nonexistentSopPrintRejected = true;
  }
  if (!nonexistentSopPrintRejected) {
    throw new Error("A nonexistent SOP version id did not return not-found for print");
  }

  const riversidePublishedSopPage = await getSopVersionHistoryReport(managerContext, {
    search: "",
    category: "",
    status: "published",
    locationId: seedIds.locations.riverside,
    page: 1,
    pageSize: 1,
  });
  const riversidePublishedSopRow = riversidePublishedSopPage.items[0];
  if (riversidePublishedSopRow) {
    let scopedSopPrintRejected = false;
    try {
      await getSopVersionForPrint(scopedManagerContext, riversidePublishedSopRow.id);
    } catch {
      scopedSopPrintRejected = true;
    }
    if (!scopedSopPrintRejected) {
      throw new Error("A location-scoped manager could print a SOP version outside their location");
    }
  }

  const sopVersionPdfBytes = await renderSopVersionPdf({
    sopTitle: sopPrintRecord.version.title,
    versionNumber: sopPrintRecord.version.versionNumber,
    status: sopPrintRecord.version.status,
    category: sopPrintRecord.category,
    difficulty: sopPrintRecord.version.difficulty,
    estimatedMinutes: sopPrintRecord.version.estimatedMinutes,
    changeSummary: sopPrintRecord.version.changeSummary,
    publishedAt: sopPrintRecord.version.publishedAt,
    locationName: sopPrintRecord.locationName,
    stationName: sopPrintRecord.stationName,
    materials: sopPrintRecord.materials,
    warnings: sopPrintRecord.warnings,
    steps: sopPrintRecord.steps,
  });
  await assertValidPdf(sopVersionPdfBytes, "SOP version PDF");

  // Training session print record, reusing the Phase 14 report fixture's completed assignment.
  const reportPathAssignmentDetail = await getManagerAssignmentDetail(
    managerContext,
    reportPathAssignmentId,
  );
  const reportPathSessionId = reportPathAssignmentDetail.latestSession?.id;
  if (!reportPathSessionId) {
    throw new Error("The Phase 14 report fixture assignment had no completed session to print");
  }
  const trainingSessionPrintRecord = await getTrainingSessionForPrint(
    managerContext,
    reportPathSessionId,
  );
  if (
    trainingSessionPrintRecord.employeeName !== reportPathEmployee.displayName ||
    trainingSessionPrintRecord.sopTitle !== reportPathSop.version.title
  ) {
    throw new Error("Training session print record did not match its own assignment fixture");
  }
  let scopedTrainingSessionPrintRejected = false;
  try {
    await getTrainingSessionForPrint(scopedManagerContext, reportPathSessionId);
  } catch {
    scopedTrainingSessionPrintRejected = true;
  }
  // The Phase 14 fixture employee is at Downtown, which the scoped manager *does* manage, so this
  // print stays permitted — proves the guard runs rather than always throwing, complementing the
  // SOP version check above (which proves the opposite: a real cross-location rejection).
  if (scopedTrainingSessionPrintRejected) {
    throw new Error(
      "A location-scoped manager was incorrectly denied printing a session within their location",
    );
  }
  let nonexistentTrainingSessionPrintRejected = false;
  try {
    await getTrainingSessionForPrint(managerContext, randomUUID());
  } catch {
    nonexistentTrainingSessionPrintRejected = true;
  }
  if (!nonexistentTrainingSessionPrintRejected) {
    throw new Error("A nonexistent training session id did not return not-found for print");
  }

  const trainingSessionPdfBytes = await renderTrainingSessionPdf(trainingSessionPrintRecord);
  await assertValidPdf(trainingSessionPdfBytes, "Training session PDF");

  // Qualification print record, reusing the same Phase 14 fixture's awarded qualification.
  if (!firstQualificationRow.qualificationId) {
    throw new Error("The Phase 14 qualification fixture row had no awarded qualification id");
  }
  const qualificationPrintRecord = await getQualificationDetail(
    managerContext,
    firstQualificationRow.qualificationId,
  );
  const qualificationPdfBytes = await renderQualificationPdf({
    employeeName: qualificationPrintRecord.employeeName,
    employeeNumber: qualificationPrintRecord.employeeNumber,
    locationName: qualificationPrintRecord.locationName,
    definitionName: qualificationPrintRecord.definition.name,
    definitionDescription: qualificationPrintRecord.definition.description,
    pathTitle: qualificationPrintRecord.path.title,
    status: qualificationPrintRecord.status,
    awardedAt: qualificationPrintRecord.awardedAt,
    expiresAt: qualificationPrintRecord.expiresAt,
    isExpired: qualificationPrintRecord.isExpired,
    revokedAt: qualificationPrintRecord.revokedAt,
    revokedNote: qualificationPrintRecord.revokedNote,
    supportingSessions: qualificationPrintRecord.supportingSessions,
  });
  await assertValidPdf(qualificationPdfBytes, "Qualification PDF");

  // Checklist run print record, reusing the Phase 14 checklist completion report fixture.
  const checklistRunPrintRecord = await getChecklistRunDetail(managerContext, firstChecklistRow.id);
  const checklistRunPdfBytes = await renderChecklistRunPdf({
    checklistTitle: checklistRunPrintRecord.checklistTitle,
    checklistType: checklistRunPrintRecord.checklistType,
    employeeName: checklistRunPrintRecord.employeeName,
    employeeNumber: checklistRunPrintRecord.employeeNumber,
    locationName: checklistRunPrintRecord.locationName,
    status: checklistRunPrintRecord.status,
    startedAt: checklistRunPrintRecord.startedAt,
    submittedAt: checklistRunPrintRecord.submittedAt,
    completedAt: checklistRunPrintRecord.completedAt,
    items: checklistRunPrintRecord.items,
  });
  await assertValidPdf(checklistRunPdfBytes, "Checklist run PDF");

  // CSV export row fidelity: each mapper's row count must match its report's own item count, and
  // a known field from the report fixture must survive into the encoded CSV text.
  const trainingCsv = trainingProgressReportToCsv(trainingReportPage.items);
  if (trainingCsv.split("\r\n").length - 2 !== trainingReportPage.items.length) {
    throw new Error("Training progress CSV export row count did not match the report");
  }
  if (!trainingCsv.includes(firstTrainingRow.sopTitle)) {
    throw new Error("Training progress CSV export did not include the reported SOP title");
  }
  const qualificationsCsv = qualificationsReportToCsv(qualificationsReportWide.items);
  if (qualificationsCsv.split("\r\n").length - 2 !== qualificationsReportWide.items.length) {
    throw new Error("Qualifications CSV export row count did not match the report");
  }
  if (!qualificationsCsv.includes(reportPath.definition.name)) {
    throw new Error("Qualifications CSV export did not include the fixture qualification's name");
  }
  const checklistCsv = checklistCompletionReportToCsv(checklistReportPage.items);
  if (checklistCsv.split("\r\n").length - 2 !== checklistReportPage.items.length) {
    throw new Error("Checklist completion CSV export row count did not match the report");
  }
  const sopVersionsCsv = sopVersionHistoryReportToCsv(sopVersionReportPage.items);
  if (sopVersionsCsv.split("\r\n").length - 2 !== sopVersionReportPage.items.length) {
    throw new Error("SOP version history CSV export row count did not match the report");
  }
  const approvalsCsv = approvalHistoryReportToCsv(approvalHistoryPage.items);
  if (approvalsCsv.split("\r\n").length - 2 !== approvalHistoryPage.items.length) {
    throw new Error("Approval history CSV export row count did not match the report");
  }

  // CSV/formula injection safety: a display name that opens with a formula-trigger character
  // must reach the export defused, exercised end-to-end through a real fixture rather than only
  // the pure-function unit tests, since a manager-entered note is untrusted input from a
  // spreadsheet's point of view even though StationSnap itself generated the surrounding row.
  const csvInjectionEmployee = await createEmployee(managerContext, {
    primaryLocationId: seedIds.locations.downtown,
    employeeNumber: "9106",
    displayName: '=HYPERLINK("http://evil","Riley Reportee")',
    jobRole: "Cook",
    language: "en",
    pin: "9106",
    status: "active",
  });
  const csvInjectionAssign = await assignTraining(
    managerContext,
    {
      sopId: reportPathSop.id,
      target: { type: "employees", employeeIds: [csvInjectionEmployee.id] },
    },
    "verify-phase15-csv-injection-assign",
  );
  const csvInjectionAssignmentId = csvInjectionAssign.created[0]?.id;
  if (!csvInjectionAssignmentId) {
    throw new Error("The Phase 15 CSV-injection fixture assignment was not created");
  }
  const csvInjectionTrainingReport = await getTrainingProgressReport(managerContext, {
    status: "",
    locationId: "",
    // The report's `search` filter matches display name and SOP title, not employee number, so
    // this searches on a substring unique to the crafted display name itself.
    search: "HYPERLINK",
    page: 1,
    pageSize: 5,
  });
  const csvInjectionCsv = trainingProgressReportToCsv(csvInjectionTrainingReport.items);
  // A defused, comma/quote-containing field is wrapped and opens with `"'=HYPERLINK`; an
  // undefused one would instead open with a bare `"=HYPERLINK` — check for the exact absence of
  // that undefused opening rather than just the presence of the defused one, in case wrapping
  // logic regresses in a way that still coincidentally includes an apostrophe elsewhere.
  if (csvInjectionCsv.includes(`"=HYPERLINK`)) {
    throw new Error("A formula-triggering employee name reached the CSV export undefused");
  }
  if (!csvInjectionCsv.includes(`"'=HYPERLINK`)) {
    throw new Error("A formula-triggering employee name was not defused with the expected prefix");
  }

  // --- Phase 16: idempotent in-app and SMTP-backed email notifications ---
  // Every fixture above already exercised every mutation that now also dispatches a Phase 16
  // notification (bulk assignment creation, session completion into awaiting_approval/passed/
  // failed, training and checklist approval decisions, qualification award/revoke, checklist run
  // submission into awaiting_approval), so this section proves the resulting `notifications`/
  // `notification_deliveries` rows, list/read-state reads, dedupe idempotency, disabled-recipient
  // suppression, and the time-based due/expiry reconcile pass, rather than re-deriving new
  // fixtures for most of it.

  const notificationTypeRows = await getDb()
    .select({ type: notifications.type })
    .from(notifications)
    .where(eq(notifications.organizationId, seedIds.organization));
  const observedNotificationTypes = new Set(notificationTypeRows.map((row) => row.type));
  const expectedEventDrivenNotificationTypes = [
    "training.assigned",
    "training.awaiting_approval",
    "training.completed",
    "training.approval_decided",
    "qualification.awarded",
    "qualification.revoked",
    "checklist_run.awaiting_approval",
    "checklist_run.approval_decided",
  ] as const;
  const missingNotificationTypes = expectedEventDrivenNotificationTypes.filter(
    (type) => !observedNotificationTypes.has(type),
  );
  if (missingNotificationTypes.length > 0) {
    throw new Error(
      `Missing notification types from earlier fixtures: ${missingNotificationTypes.join(", ")}`,
    );
  }
  // sop.published, sop.archived, checklist.created, and translation.approved are deliberately not
  // notification-worthy on their own — they stay purely on /manager/activity via domain_events, so
  // the dispatcher must never have generated a notification for one of them.
  const nonNotificationTypes = [
    "sop.published",
    "sop.archived",
    "checklist.created",
    "translation.approved",
  ] as const;
  if (nonNotificationTypes.some((type) => observedNotificationTypes.has(type))) {
    throw new Error(
      "A domain event type outside Phase 16's notification-worthy set produced a notification",
    );
  }

  // Every domain event this run produced so far was dispatched synchronously at its own write
  // site, so none should still be `pending` — the reconcile catch-up path only does real work in
  // the dedicated fixture further down.
  const pendingBeforeReconcile = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(domainEvents)
    .where(
      and(
        eq(domainEvents.organizationId, seedIds.organization),
        eq(domainEvents.processingStatus, "pending"),
      ),
    );
  if ((pendingBeforeReconcile[0]?.count ?? 0) !== 0) {
    throw new Error(
      "A domain event was left unprocessed despite dispatching synchronously at every write site",
    );
  }

  // Employee inbox: the Phase 14 report-path employee was assigned, completed training, and was
  // awarded a qualification earlier in this run, so all three notification types should already
  // be in their inbox, unread.
  const reportPathEmployeeNotifications = await listNotificationsForEmployee(
    reportPathEmployeeSession,
    { unreadOnly: "", type: "", page: 1, pageSize: 100 },
  );
  const reportPathEmployeeTypes = new Set(
    reportPathEmployeeNotifications.items.map((item) => item.type),
  );
  if (
    !reportPathEmployeeTypes.has("training.assigned") ||
    !reportPathEmployeeTypes.has("training.completed") ||
    !reportPathEmployeeTypes.has("qualification.awarded")
  ) {
    throw new Error("The report-path employee's inbox was missing an expected notification type");
  }
  if (reportPathEmployeeNotifications.items.some((item) => item.readAt !== null)) {
    throw new Error("A freshly generated notification was already marked read");
  }

  // Mark-as-read: idempotent (a second mark-read on the same notification is a harmless no-op),
  // reflected immediately in an unreadOnly re-list, and scoped strictly to the acting recipient —
  // a manager cannot mark an employee's notification read through the manager-side function, since
  // it only ever matches rows whose recipientType is "manager".
  const firstUnread = reportPathEmployeeNotifications.items[0];
  if (!firstUnread) throw new Error("Expected at least one unread notification to mark read");
  await markEmployeeNotificationRead(reportPathEmployeeSession, firstUnread.id);
  await markEmployeeNotificationRead(reportPathEmployeeSession, firstUnread.id);
  const afterMarkRead = await listNotificationsForEmployee(reportPathEmployeeSession, {
    unreadOnly: "1",
    type: "",
    page: 1,
    pageSize: 100,
  });
  if (afterMarkRead.items.some((item) => item.id === firstUnread.id)) {
    throw new Error("A read notification still appeared in the unread-only list");
  }
  let crossRecipientMarkReadRejected = false;
  try {
    await markManagerNotificationRead(managerContext, firstUnread.id);
  } catch {
    crossRecipientMarkReadRejected = true;
  }
  if (!crossRecipientMarkReadRejected) {
    throw new Error("A manager was able to mark an employee's notification read");
  }

  // Manager inbox: the owner sees org-wide notifications, including approval-queue items awaiting
  // review; a Downtown-scoped manager never receives one addressed to a Riverside-only recipient.
  const ownerNotifications = await listNotificationsForManager(managerContext, {
    unreadOnly: "",
    type: "",
    page: 1,
    pageSize: 200,
  });
  if (ownerNotifications.total === 0) {
    throw new Error("The owner's notification inbox was unexpectedly empty");
  }
  const ownerNotificationTypes = new Set(ownerNotifications.items.map((item) => item.type));
  if (
    !ownerNotificationTypes.has("training.awaiting_approval") &&
    !ownerNotificationTypes.has("checklist_run.awaiting_approval")
  ) {
    throw new Error("The owner's inbox never received an approval-queue notification");
  }
  const scopedManagerNotifications = await listNotificationsForManager(scopedManagerContext, {
    unreadOnly: "",
    type: "",
    page: 1,
    pageSize: 200,
  });
  if (
    scopedManagerNotifications.items.some(
      (item) => item.locationId !== null && item.locationId !== seedIds.locations.downtown,
    )
  ) {
    throw new Error(
      "A location-scoped manager received a notification outside their managed location",
    );
  }

  // Disabled employee recipients receive nothing: `phaseThreeEmployee` has been disabled since
  // early in this run. Attach a qualification-award event to them directly — the dispatcher must
  // consult the employee's *current* status, not whatever it was when the underlying business row
  // was written, and generate nothing.
  const disabledEmployeeQualificationId = randomUUID();
  await getDb().insert(employeeQualifications).values({
    id: disabledEmployeeQualificationId,
    organizationId: seedIds.organization,
    employeeId: phaseThreeEmployee.id,
    definitionId: reportPath.definition.id,
    sourcePathId: reportPath.id,
    awardedAt: new Date(),
    status: "active",
  });
  const disabledEmployeeEvent: DomainEventRecord = {
    id: randomUUID(),
    organizationId: seedIds.organization,
    locationId: seedIds.locations.downtown,
    type: "qualification.awarded",
    subjectType: "employee_qualification",
    subjectId: disabledEmployeeQualificationId,
    payload: { definitionId: reportPath.definition.id, isNewAward: true },
    occurredAt: new Date(),
  };
  await dispatchNotificationsForDomainEvent(disabledEmployeeEvent);
  const disabledEmployeeNotificationCount = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientType, "employee"),
        eq(notifications.recipientId, phaseThreeEmployee.id),
      ),
    );
  if ((disabledEmployeeNotificationCount[0]?.count ?? 0) !== 0) {
    throw new Error("A disabled employee received a notification");
  }

  // Disabled manager recipients receive nothing: the Riverside manager fixture is a valid
  // recipient candidate for Riverside before being disabled, and is excluded afterward.
  const riversideRecipientsBeforeDisable = await getLocationRecipientManagers(
    seedIds.organization,
    seedIds.locations.riverside,
  );
  if (
    !riversideRecipientsBeforeDisable.some(
      (manager) => manager.membershipId === seedIds.memberships.riverside,
    )
  ) {
    throw new Error(
      "The Riverside manager fixture was not a recipient candidate before being disabled",
    );
  }
  await disableManagerAccount(
    managerContext,
    seedIds.memberships.riverside,
    "verify-phase16-disable-manager",
  );
  const riversideRecipientsAfterDisable = await getLocationRecipientManagers(
    seedIds.organization,
    seedIds.locations.riverside,
  );
  if (
    riversideRecipientsAfterDisable.some(
      (manager) => manager.membershipId === seedIds.memberships.riverside,
    )
  ) {
    throw new Error("A disabled manager was still returned as a notification recipient candidate");
  }

  // Retry/dedupe idempotency: queue a second "qualification.awarded" event for an employee who
  // already has one, simulating a retried or duplicated dispatch (e.g. after a mid-request crash
  // between the notification insert and marking the event processed). Dispatching it twice in a
  // row must still leave exactly one notification row for that event's dedupe key.
  const retryEventId = randomUUID();
  await getDb()
    .insert(domainEvents)
    .values({
      id: retryEventId,
      organizationId: seedIds.organization,
      locationId: seedIds.locations.downtown,
      type: "qualification.awarded",
      subjectType: "employee_qualification",
      subjectId: samQualification.id,
      payload: { definitionId: samQualification.definitionId, isNewAward: false },
    });
  const [retryEventRow] = await getDb()
    .select()
    .from(domainEvents)
    .where(eq(domainEvents.id, retryEventId))
    .limit(1);
  if (!retryEventRow) throw new Error("The dedupe-retry fixture domain event was not inserted");
  const retryEvent: DomainEventRecord = {
    id: retryEventRow.id,
    organizationId: retryEventRow.organizationId,
    locationId: retryEventRow.locationId,
    type: retryEventRow.type as DomainEventRecord["type"],
    subjectType: retryEventRow.subjectType as DomainEventRecord["subjectType"],
    subjectId: retryEventRow.subjectId,
    payload: retryEventRow.payload,
    occurredAt: retryEventRow.occurredAt,
  };
  await dispatchNotificationsForDomainEvent(retryEvent);
  await dispatchNotificationsForDomainEvent(retryEvent);
  const retryDedupeKey = `event:${retryEventId}:employee:${samQualification.employeeId}`;
  const retryNotificationCount = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(eq(notifications.dedupeKey, retryDedupeKey));
  if ((retryNotificationCount[0]?.count ?? 0) !== 1) {
    throw new Error("A retried domain event dispatch produced more than one notification");
  }
  const [retryEventAfter] = await getDb()
    .select({ processingStatus: domainEvents.processingStatus })
    .from(domainEvents)
    .where(eq(domainEvents.id, retryEventId))
    .limit(1);
  if (retryEventAfter?.processingStatus !== "processed") {
    throw new Error("A dispatched domain event was not marked processed");
  }

  // Catch-up reconcile: insert one more pending event directly, bypassing the synchronous dispatch
  // every real write site performs, to prove `reconcilePendingDomainEventNotifications` — the
  // entry point both notification pages call on every read — finds and processes it.
  const catchUpEventId = randomUUID();
  await getDb().insert(domainEvents).values({
    id: catchUpEventId,
    organizationId: seedIds.organization,
    locationId: seedIds.locations.downtown,
    type: "qualification.revoked",
    subjectType: "employee_qualification",
    subjectId: samQualification.id,
    payload: {},
  });
  await reconcilePendingDomainEventNotifications(seedIds.organization);
  const catchUpDedupeKey = `event:${catchUpEventId}:employee:${samQualification.employeeId}`;
  const catchUpNotification = await getDb()
    .select({ id: notifications.id })
    .from(notifications)
    .where(eq(notifications.dedupeKey, catchUpDedupeKey))
    .limit(1);
  if (catchUpNotification.length === 0) {
    throw new Error("reconcilePendingDomainEventNotifications did not process a pending event");
  }
  const [catchUpEventAfter] = await getDb()
    .select({ processingStatus: domainEvents.processingStatus })
    .from(domainEvents)
    .where(eq(domainEvents.id, catchUpEventId))
    .limit(1);
  if (catchUpEventAfter?.processingStatus !== "processed") {
    throw new Error("The catch-up reconcile pass did not mark its event processed");
  }

  // Manager email delivery bookkeeping: this environment has no SMTP configured, so every manager
  // notification's email delivery attempt must be recorded as `skipped` with a safe, non-secret
  // error code — never silently dropped, and never containing anything from a raw provider error.
  const emailDeliveryRows = await getDb()
    .select({ status: notificationDeliveries.status, errorCode: notificationDeliveries.errorCode })
    .from(notificationDeliveries)
    .innerJoin(
      notifications,
      and(
        eq(notifications.id, notificationDeliveries.notificationId),
        eq(notifications.organizationId, notificationDeliveries.organizationId),
      ),
    )
    .where(
      and(
        eq(notificationDeliveries.organizationId, seedIds.organization),
        eq(notificationDeliveries.channel, "email"),
        eq(notifications.recipientType, "manager"),
      ),
    );
  if (emailDeliveryRows.length === 0) {
    throw new Error("No manager notification ever attempted an email delivery");
  }
  if (
    emailDeliveryRows.some(
      (row) => row.status !== "skipped" || row.errorCode !== "smtp_not_configured",
    )
  ) {
    throw new Error(
      "An email delivery attempt in an SMTP-less environment was not recorded as safely skipped",
    );
  }

  // Time-based reconcile: due-soon/overdue training and an expiring-soon qualification, gated to
  // run at most once per organization per organization-local calendar day.
  const timeFixtureEmployee = await createEmployee(managerContext, {
    primaryLocationId: seedIds.locations.downtown,
    employeeNumber: "9108",
    displayName: "Taylor Deadline",
    jobRole: "Cook",
    language: "en",
    pin: "9108",
    status: "active",
  });
  const dueSoonSopFixture = await createMinimalPublishedSop(
    managerContext,
    "Phase 16 Due Soon Fixture SOP",
    seedIds.locations.downtown,
    "verify-phase16-due-soon-sop",
  );
  const overdueSopFixture = await createMinimalPublishedSop(
    managerContext,
    "Phase 16 Overdue Fixture SOP",
    seedIds.locations.downtown,
    "verify-phase16-overdue-sop",
  );
  const dueSoonAssign = await assignTraining(
    managerContext,
    {
      sopId: dueSoonSopFixture.id,
      target: { type: "employees", employeeIds: [timeFixtureEmployee.id] },
    },
    "verify-phase16-due-soon-assign",
  );
  const overdueAssign = await assignTraining(
    managerContext,
    {
      sopId: overdueSopFixture.id,
      target: { type: "employees", employeeIds: [timeFixtureEmployee.id] },
    },
    "verify-phase16-overdue-assign",
  );
  const dueSoonAssignmentId = dueSoonAssign.created[0]?.id;
  const overdueAssignmentId = overdueAssign.created[0]?.id;
  if (!dueSoonAssignmentId || !overdueAssignmentId) {
    throw new Error("The Phase 16 time-reconcile fixture assignments were not created");
  }
  const timeReconcileNow = new Date();
  await getDb()
    .update(trainingAssignments)
    .set({
      dueAt: new Date(timeReconcileNow.getTime() + 24 * 60 * 60 * 1000),
      dueTimezone: "America/Chicago",
    })
    .where(eq(trainingAssignments.id, dueSoonAssignmentId));
  await getDb()
    .update(trainingAssignments)
    .set({
      dueAt: new Date(timeReconcileNow.getTime() - 24 * 60 * 60 * 1000),
      dueTimezone: "America/Chicago",
    })
    .where(eq(trainingAssignments.id, overdueAssignmentId));

  const [reportPathEmployeeQualificationRow] = await getDb()
    .select()
    .from(employeeQualifications)
    .where(eq(employeeQualifications.employeeId, reportPathEmployee.id));
  if (!reportPathEmployeeQualificationRow) {
    throw new Error("Expected the report-path employee to already have an awarded qualification");
  }
  await getDb()
    .update(employeeQualifications)
    .set({ expiresAt: new Date(timeReconcileNow.getTime() + 15 * 24 * 60 * 60 * 1000) })
    .where(eq(employeeQualifications.id, reportPathEmployeeQualificationRow.id));

  await reconcileTimeBasedNotifications(seedIds.organization, timeReconcileNow);

  const dueSoonNotification = await getDb()
    .select({ id: notifications.id })
    .from(notifications)
    .where(eq(notifications.dedupeKey, `due_soon:${dueSoonAssignmentId}`))
    .limit(1);
  if (dueSoonNotification.length === 0) {
    throw new Error("The due-soon reconcile scan did not notify the employee");
  }
  const overdueNotification = await getDb()
    .select({ id: notifications.id })
    .from(notifications)
    .where(eq(notifications.dedupeKey, `overdue:${overdueAssignmentId}`))
    .limit(1);
  if (overdueNotification.length === 0) {
    throw new Error("The overdue reconcile scan did not notify the employee");
  }
  const expiringSoonNotification = await getDb()
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      eq(
        notifications.dedupeKey,
        `qualification_expiring:${reportPathEmployeeQualificationRow.id}`,
      ),
    )
    .limit(1);
  if (expiringSoonNotification.length === 0) {
    throw new Error("The expiring-soon reconcile scan did not notify the employee");
  }

  // Same-day guard: a second reconcile call for the same organization and moment must not run the
  // scans again — no new `scheduled_job_runs` row.
  const jobRunsBeforeSecondCall = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(scheduledJobRuns)
    .where(
      and(
        eq(scheduledJobRuns.organizationId, seedIds.organization),
        eq(scheduledJobRuns.jobType, "notification_time_reconcile"),
      ),
    );
  await reconcileTimeBasedNotifications(seedIds.organization, timeReconcileNow);
  const jobRunsAfterSecondCall = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(scheduledJobRuns)
    .where(
      and(
        eq(scheduledJobRuns.organizationId, seedIds.organization),
        eq(scheduledJobRuns.jobType, "notification_time_reconcile"),
      ),
    );
  if (jobRunsAfterSecondCall[0]?.count !== jobRunsBeforeSecondCall[0]?.count) {
    throw new Error("A same-day reconcile call was not treated as a no-op");
  }

  // Timezone boundary: shifting `now` by a few hours that cross a UTC day boundary but stay within
  // the same *organization-local* calendar day must still land in the same bucket (no-op) — the
  // seed organization's timezone is America/Chicago (UTC-5/UTC-6), so a multi-hour shift can cross
  // midnight UTC while staying on the same Chicago calendar date.
  const [orgRow] = await getDb()
    .select({ timezone: organizations.timezone })
    .from(organizations)
    .where(eq(organizations.id, seedIds.organization))
    .limit(1);
  if (!orgRow)
    throw new Error("Seed organization row was not found for the timezone-boundary check");
  const sameLocalDayLater = new Date(timeReconcileNow.getTime() + 3 * 60 * 60 * 1000);
  if (
    calendarDateInTimeZone(sameLocalDayLater, orgRow.timezone) ===
    calendarDateInTimeZone(timeReconcileNow, orgRow.timezone)
  ) {
    await reconcileTimeBasedNotifications(seedIds.organization, sameLocalDayLater);
    const jobRunsAfterSameDayShift = await getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(scheduledJobRuns)
      .where(
        and(
          eq(scheduledJobRuns.organizationId, seedIds.organization),
          eq(scheduledJobRuns.jobType, "notification_time_reconcile"),
        ),
      );
    if (jobRunsAfterSameDayShift[0]?.count !== jobRunsBeforeSecondCall[0]?.count) {
      throw new Error(
        "A same-organization-local-day reconcile call (shifted a few hours) was not treated as a no-op",
      );
    }
  }

  // A full day later is a genuinely new local calendar day: the guard must allow a new run.
  const nextLocalDay = new Date(timeReconcileNow.getTime() + 26 * 60 * 60 * 1000);
  await reconcileTimeBasedNotifications(seedIds.organization, nextLocalDay);
  const jobRunsAfterNextDay = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(scheduledJobRuns)
    .where(
      and(
        eq(scheduledJobRuns.organizationId, seedIds.organization),
        eq(scheduledJobRuns.jobType, "notification_time_reconcile"),
      ),
    );
  if ((jobRunsAfterNextDay[0]?.count ?? 0) <= (jobRunsBeforeSecondCall[0]?.count ?? 0)) {
    throw new Error(
      "A reconcile call a full day later did not start a new scheduled_job_runs entry",
    );
  }

  // --- Phase 17: audit every boundary ---
  // Uploads are now checked against a real file-signature allowlist in addition to the
  // client-declared MIME type; a mismatch (real PNG bytes declared as a JPEG) must be rejected.
  let mismatchedSignatureRejected = false;
  try {
    const spoofedForm = new FormData();
    spoofedForm.set(
      "file",
      new File([new Uint8Array(smallPng)], "spoofed.jpg", { type: "image/jpeg" }),
    );
    await uploadMedia(managerContext, spoofedForm, "verify-media-signature-mismatch");
  } catch {
    mismatchedSignatureRejected = true;
  }
  if (!mismatchedSignatureRejected) {
    throw new Error("A file whose bytes did not match its declared MIME type was accepted");
  }

  // Manager-authored SOP media (the Phase 4 Downtown cover image) must be location-scoped like
  // every other manager-facing SOP read, not merely organization-scoped: the Riverside-only
  // manager must not be able to read it, while the owner (organization-wide) still can.
  let downtownCoverRejectedForRiversideManager = false;
  try {
    await getMediaFile(riversideManagerContext, cleanCover.id);
  } catch {
    downtownCoverRejectedForRiversideManager = true;
  }
  if (!downtownCoverRejectedForRiversideManager) {
    throw new Error(
      "A Riverside-only manager was able to read a Downtown SOP's manager-authored media",
    );
  }
  const ownerCoverRead = await getMediaFile(managerContext, cleanCover.id);
  if (ownerCoverRead.buffer.length === 0) {
    throw new Error(
      "The organization-wide owner could not read a manager-authored SOP cover image",
    );
  }

  // --- Phase 19: PWA metadata, production env hardening, and release verification ---
  // The production-only env rules (APP_URL/STORAGE_DRIVER requirements) and the release-check
  // script's own build/boot cycle are covered by src/lib/env.test.ts and `npm run release:check`
  // respectively — neither needs a live database. What does belong here, against this script's
  // real embedded PostgreSQL instance, is proving the health route and the PWA manifest module
  // actually work end-to-end rather than only against a mocked `getDb` (the existing
  // src/app/api/health/route.test.ts) or in isolation.
  const manifestResult = manifest();
  if (manifestResult.name !== "StationSnap" || manifestResult.start_url !== "/") {
    throw new Error("The PWA manifest did not report the expected name and start_url");
  }
  if (!manifestResult.icons || manifestResult.icons.length < 3) {
    throw new Error("The PWA manifest did not declare the expected icon set");
  }

  const healthResponse = await healthCheck();
  const healthBody = (await healthResponse.json()) as { data?: { status?: string } };
  if (healthResponse.status !== 200 || healthBody.data?.status !== "healthy") {
    throw new Error("The health check route did not report healthy against a live database");
  }

  await verifyUpgradeMigration();

  process.stdout.write(
    `Database, authentication, and management verified: ${JSON.stringify({ ...counts, managerLogin: true, employeeLogin: true, sessionExpiry: true, passwordReset: true, pinReset: true, disabledAccount: true, lastOwnerProtection: true, locationRestriction: true, tenantIsolation: true, lockout: true, upgradeMigration: true, migrationConcurrencyLock: true, organizationSettings: true, locationManagement: true, stationManagement: true, employeeManagement: true, employeeSearch: true, managerAssignments: true, sopDraftAutosave: true, sopStaleWriteRejection: true, sopStepCrudAndReorder: true, sopPublishValidation: true, sopPublishedImmutability: true, sopArchive: true, sopLibraryFiltersAndPagination: true, mediaUploadValidation: true, mediaIncompleteUploadBlocksPublish: true, sopVersionImmutability: true, sopDraftCloning: true, sopVersionHistory: true, sopVersionComparison: true, sopVersionRestoration: true, sopRetrainingRules: true, sopStableCurrentVersionResolution: true, employeeStationReader: true, employeeSopReader: true, employeeCategoryLibrary: true, employeeRecentViews: true, employeeMediaAuthorization: true, qrCreationAndTargetValidation: true, qrLocationScoping: true, qrRevocation: true, qrRotation: true, qrScanResolution: true, qrUnavailableTarget: true, qrEnumerationRateLimit: true, trainingConfigDefaultsAndScoping: true, trainingConfigStaleWriteRejection: true, trainingStepRequirementGuards: true, trainingQuestionCrudAndReorder: true, trainingPublishReadinessRules: true, trainingPublishedImmutability: true, trainingDraftCloning: true, trainingAssignmentCreationAndScoping: true, trainingSessionStartAndResume: true, trainingSequentialStepEnforcement: true, trainingWatchTimerQuestionEvidenceEnforcement: true, trainingDuplicateActionRejection: true, trainingScoringAndApprovalRouting: true, trainingSubmitIdempotency: true, trainingAttemptLimitsAndRetraining: true, bulkAssignmentAuthorizationScoping: true, bulkAssignmentByEmployeeListWithDueDate: true, bulkAssignmentByJobRole: true, bulkAssignmentByLocation: true, bulkAssignmentIndependentDuplicateSkip: true, approvalQueueLocationScoping: true, approvalEvidenceAuthorization: true, approvalDecisionNoteRules: true, approvalApprovedDecision: true, approvalRejectedDecision: true, approvalCorrectionRequest: true, approvalDecisionImmutability: true, correctionOwnershipEnforcement: true, correctionAppendOnlyEvidence: true, correctionResubmitIdempotency: true, approvalDecisionHistoryRetention: true, trainingPathAuthorizationScoping: true, trainingPathItemValidation: true, trainingPathOrderedBlocking: true, qualificationAward: true, qualificationRenewal: true, qualificationOverviewClassification: true, qualificationEmployeeView: true, qualificationRevocation: true, trainingPathArchiveStopsAwards: true, checklistAuthorizationScoping: true, checklistDuplicateTitleRejection: true, checklistRunStartAndResume: true, checklistAutoRequirementGuardsManualTick: true, checklistTimerPhotoNoteEnforcement: true, checklistSubmitRequiresAllRequiredItems: true, checklistDuplicateOccurrencePrevention: true, checklistApprovalRouting: true, checklistApprovalUnauthorizedRejection: true, checklistCorrectionRequestAndResubmit: true, checklistCorrectionResubmitIdempotency: true, checklistApprovalDecisionCompletesRun: true, checklistSubmitIdempotency: true, checklistRunListLocationScoping: true, checklistItemRemovalDisablesRatherThanDeletes: true, checklistHistoricalRunRetainsRemovedItem: true, translationMatrixExcludesProtectedFields: true, translationLocationScoping: true, translationEntityOwnershipGuard: true, translationEmptyApprovalRejected: true, translationEditResetsApproval: true, translationStaleSourceDetection: true, translationEmployeeLocaleSwitchPreservesProtectedFields: true, translationUnapprovedFallsBackToOriginal: true, domainEventEmissionCoverage: true, activityFeedLocationScoping: true, activityFeedTypeFilterAndPagination: true, trainingProgressReportFilteringAndScoping: true, qualificationsReportFilteringAndPagination: true, checklistCompletionReportFilteringAndScoping: true, sopVersionHistoryReportFilteringAndScoping: true, approvalHistoryReportUnionAndScoping: true, sopVersionPrintRecordFidelity: true, sopVersionPrintDraftRejection: true, sopVersionPrintLocationScoping: true, trainingSessionPrintRecordFidelity: true, trainingSessionPrintLocationScoping: true, printPdfGeneration: true, printPdfTextFidelity: true, csvExportRowFidelity: true, csvExportFormulaInjectionDefusing: true, notificationDomainEventCoverage: true, notificationNonNotificationTypesExcluded: true, notificationSynchronousDispatch: true, notificationEmployeeInbox: true, notificationMarkReadIdempotencyAndScoping: true, notificationManagerInboxAndLocationScoping: true, notificationDisabledEmployeeSuppression: true, notificationDisabledManagerSuppression: true, notificationDedupeKeyRetryIdempotency: true, notificationPendingEventReconcile: true, notificationEmailSkippedWithoutSmtp: true, notificationTimeBasedDueSoonAndOverdue: true, notificationTimeBasedExpiringSoon: true, notificationTimeReconcileSameDayGuard: true, notificationTimeReconcileTimezoneBoundary: true, mediaSignatureValidation: true, mediaManagerAuthoredLocationScoping: true, pwaManifestConfiguration: true, healthCheckLiveDatabase: true })}\n`,
  );
}

try {
  await verifyDatabase();
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
  await postgres.stop();
}
