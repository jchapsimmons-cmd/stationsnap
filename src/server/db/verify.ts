import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import EmbeddedPostgres from "embedded-postgres";
import { Pool } from "pg";
import { endOfDayInTimeZone } from "@/lib/timezone";
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
  approvalSubmissions,
  files as filesTable,
  qrScanEvents,
  trainingAssignments,
} from "@/server/db/schema";
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
import { getMediaFileForEmployee, uploadMedia } from "@/server/storage/media-service";
import {
  assignTraining,
  getAssignmentDetail,
  getSessionState,
  recordStepAction,
  startOrResumeSession,
  submitAnswer,
  submitSession,
  submitStepEvidence,
} from "@/server/training/service";

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
      new File([new Uint8Array(Buffer.from("not-a-real-video"))], "reference.mp4", {
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
      new File([new Uint8Array(Buffer.from("not-a-real-video"))], "proof.mp4", {
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
  ];
  if (requiredAuditActions.some((action) => !actions.has(action))) {
    throw new Error(
      `Missing required audit actions: ${requiredAuditActions.filter((action) => !actions.has(action)).join(", ")}`,
    );
  }

  await verifyUpgradeMigration();

  process.stdout.write(
    `Database, authentication, and management verified: ${JSON.stringify({ ...counts, managerLogin: true, employeeLogin: true, sessionExpiry: true, passwordReset: true, pinReset: true, disabledAccount: true, lastOwnerProtection: true, locationRestriction: true, tenantIsolation: true, lockout: true, upgradeMigration: true, migrationConcurrencyLock: true, organizationSettings: true, locationManagement: true, stationManagement: true, employeeManagement: true, employeeSearch: true, managerAssignments: true, sopDraftAutosave: true, sopStaleWriteRejection: true, sopStepCrudAndReorder: true, sopPublishValidation: true, sopPublishedImmutability: true, sopArchive: true, sopLibraryFiltersAndPagination: true, mediaUploadValidation: true, mediaIncompleteUploadBlocksPublish: true, sopVersionImmutability: true, sopDraftCloning: true, sopVersionHistory: true, sopVersionComparison: true, sopVersionRestoration: true, sopRetrainingRules: true, sopStableCurrentVersionResolution: true, employeeStationReader: true, employeeSopReader: true, employeeCategoryLibrary: true, employeeRecentViews: true, employeeMediaAuthorization: true, qrCreationAndTargetValidation: true, qrLocationScoping: true, qrRevocation: true, qrRotation: true, qrScanResolution: true, qrUnavailableTarget: true, qrEnumerationRateLimit: true, trainingConfigDefaultsAndScoping: true, trainingConfigStaleWriteRejection: true, trainingStepRequirementGuards: true, trainingQuestionCrudAndReorder: true, trainingPublishReadinessRules: true, trainingPublishedImmutability: true, trainingDraftCloning: true, trainingAssignmentCreationAndScoping: true, trainingSessionStartAndResume: true, trainingSequentialStepEnforcement: true, trainingWatchTimerQuestionEvidenceEnforcement: true, trainingDuplicateActionRejection: true, trainingScoringAndApprovalRouting: true, trainingSubmitIdempotency: true, trainingAttemptLimitsAndRetraining: true, bulkAssignmentAuthorizationScoping: true, bulkAssignmentByEmployeeListWithDueDate: true, bulkAssignmentByJobRole: true, bulkAssignmentByLocation: true, bulkAssignmentIndependentDuplicateSkip: true })}\n`,
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
