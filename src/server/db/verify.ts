import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import EmbeddedPostgres from "embedded-postgres";
import { Pool } from "pg";
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
  listEmployees,
  setManagerLocationAssignments,
  updateEmployee,
  updateLocation,
  updateOrganization,
} from "@/server/management/service";
import { files as filesTable } from "@/server/db/schema";
import {
  archiveSop,
  autosaveSopDraft,
  createSop,
  createStep,
  deleteStep,
  duplicateStep,
  getPublishReadiness,
  getSop,
  listSops,
  previewSop,
  publishSop,
  reorderSteps,
  updateStep,
} from "@/server/sops/service";
import { uploadMedia } from "@/server/storage/media-service";

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
    await publishSop(managerContext, sopDraft.id, undefined, "verify-publish-no-steps");
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
      finalStep.version.revision - 1,
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
    finalStep.version.revision,
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
      stalledDraft.version.revision + 1,
      "verify-publish-stalled-media",
    );
  } catch {
    stalledPublishRejected = true;
  }
  if (!stalledPublishRejected)
    throw new Error("Publish succeeded despite an incomplete media upload");

  const previewed = await previewSop(managerContext, secondDraft.id, "verify-sop-preview");
  if (previewed.id !== secondDraft.id) throw new Error("SOP preview did not return the SOP");

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
    "media.uploaded",
  ];
  if (requiredAuditActions.some((action) => !actions.has(action))) {
    throw new Error(
      `Missing required audit actions: ${requiredAuditActions.filter((action) => !actions.has(action)).join(", ")}`,
    );
  }

  await verifyUpgradeMigration();

  process.stdout.write(
    `Database, authentication, and management verified: ${JSON.stringify({ ...counts, managerLogin: true, employeeLogin: true, sessionExpiry: true, passwordReset: true, pinReset: true, disabledAccount: true, lastOwnerProtection: true, locationRestriction: true, tenantIsolation: true, lockout: true, upgradeMigration: true, organizationSettings: true, locationManagement: true, stationManagement: true, employeeManagement: true, employeeSearch: true, managerAssignments: true, sopDraftAutosave: true, sopStaleWriteRejection: true, sopStepCrudAndReorder: true, sopPublishValidation: true, sopPublishedImmutability: true, sopArchive: true, sopLibraryFiltersAndPagination: true, mediaUploadValidation: true, mediaIncompleteUploadBlocksPublish: true })}\n`,
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
