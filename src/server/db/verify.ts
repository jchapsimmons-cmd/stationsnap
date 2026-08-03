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
  ];
  if (requiredAuditActions.some((action) => !actions.has(action))) {
    throw new Error(
      `Missing required audit actions: ${requiredAuditActions.filter((action) => !actions.has(action)).join(", ")}`,
    );
  }

  await verifyUpgradeMigration();

  process.stdout.write(
    `Database, authentication, and management verified: ${JSON.stringify({ ...counts, managerLogin: true, employeeLogin: true, sessionExpiry: true, passwordReset: true, pinReset: true, disabledAccount: true, lastOwnerProtection: true, locationRestriction: true, tenantIsolation: true, lockout: true, upgradeMigration: true, organizationSettings: true, locationManagement: true, stationManagement: true, employeeManagement: true, employeeSearch: true, managerAssignments: true })}\n`,
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
