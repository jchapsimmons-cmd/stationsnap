import { pathToFileURL } from "node:url";
import { eq, inArray } from "drizzle-orm";
import { parseSeedEnv } from "@/lib/env";
import { hashSecret } from "@/server/auth/crypto";
import { closeDatabase, getDb } from "@/server/db/client";
import {
  employees,
  locations,
  managerLocationAccess,
  managerMemberships,
  managerUsers,
  organizations,
  stations,
} from "@/server/db/schema";
import { employeeSeed, managerSeed, seedIds } from "@/server/db/seed-data";
import { logger } from "@/server/logger";

export async function runSeed(): Promise<void> {
  const db = getDb();
  const seedEnv = parseSeedEnv(process.env);
  const [passwordHash, pinHash] = await Promise.all([
    hashSecret(seedEnv.SEED_MANAGER_PASSWORD),
    hashSecret(seedEnv.SEED_EMPLOYEE_PIN),
  ]);

  await db.transaction(async (tx) => {
    await tx
      .insert(organizations)
      .values({
        id: seedIds.organization,
        accessSlug: "stationsnap-demo",
        name: "StationSnap Demo Kitchen",
        defaultLanguage: "en",
        timezone: "America/Chicago",
      })
      .onConflictDoNothing();

    await tx
      .update(organizations)
      .set({ accessSlug: "stationsnap-demo" })
      .where(eq(organizations.id, seedIds.organization));

    await tx
      .insert(locations)
      .values([
        {
          id: seedIds.locations.downtown,
          organizationId: seedIds.organization,
          accessSlug: "downtown",
          name: "Downtown",
          timezone: "America/Chicago",
        },
        {
          id: seedIds.locations.riverside,
          organizationId: seedIds.organization,
          accessSlug: "riverside",
          name: "Riverside",
          timezone: "America/Chicago",
        },
      ])
      .onConflictDoNothing();

    await tx
      .update(locations)
      .set({ accessSlug: "downtown" })
      .where(eq(locations.id, seedIds.locations.downtown));
    await tx
      .update(locations)
      .set({ accessSlug: "riverside" })
      .where(eq(locations.id, seedIds.locations.riverside));

    await tx
      .insert(stations)
      .values([
        {
          id: seedIds.stations.grill,
          organizationId: seedIds.organization,
          locationId: seedIds.locations.downtown,
          name: "Grill",
          description: "Hot line grilling procedures",
          displayOrder: 1,
        },
        {
          id: seedIds.stations.fry,
          organizationId: seedIds.organization,
          locationId: seedIds.locations.downtown,
          name: "Fry Station",
          description: "Fryer setup, cooking, and cleaning",
          displayOrder: 2,
        },
        {
          id: seedIds.stations.prep,
          organizationId: seedIds.organization,
          locationId: seedIds.locations.riverside,
          name: "Prep",
          description: "Daily ingredient preparation",
          displayOrder: 1,
        },
        {
          id: seedIds.stations.frontCounter,
          organizationId: seedIds.organization,
          locationId: seedIds.locations.riverside,
          name: "Front Counter",
          description: "Guest-facing procedures",
          displayOrder: 2,
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(managerUsers)
      .values(managerSeed.map((manager) => ({ ...manager, passwordHash })))
      .onConflictDoNothing();
    await tx
      .update(managerUsers)
      .set({ passwordHash })
      .where(
        inArray(
          managerUsers.id,
          managerSeed.map((manager) => manager.id),
        ),
      );

    await tx
      .insert(managerMemberships)
      .values([
        {
          id: seedIds.memberships.owner,
          organizationId: seedIds.organization,
          managerUserId: seedIds.managers.owner,
          role: "owner",
        },
        {
          id: seedIds.memberships.downtown,
          organizationId: seedIds.organization,
          managerUserId: seedIds.managers.downtown,
          role: "manager",
        },
        {
          id: seedIds.memberships.riverside,
          organizationId: seedIds.organization,
          managerUserId: seedIds.managers.riverside,
          role: "manager",
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(managerLocationAccess)
      .values([
        {
          organizationId: seedIds.organization,
          membershipId: seedIds.memberships.downtown,
          locationId: seedIds.locations.downtown,
        },
        {
          organizationId: seedIds.organization,
          membershipId: seedIds.memberships.riverside,
          locationId: seedIds.locations.riverside,
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(employees)
      .values(
        employeeSeed.map((employee) => ({
          ...employee,
          organizationId: seedIds.organization,
          pinHash,
        })),
      )
      .onConflictDoNothing();
    await tx
      .update(employees)
      .set({ pinHash })
      .where(
        inArray(
          employees.id,
          employeeSeed.map((employee) => employee.id),
        ),
      );
  });

  logger.info(
    { organizations: 1, locations: 2, stations: 4, managers: 3, employees: 5 },
    "Demo seed data loaded",
  );
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  runSeed()
    .catch((error: unknown) => {
      logger.error({ err: error }, "Database seed failed");
      process.exitCode = 1;
    })
    .finally(closeDatabase);
}
