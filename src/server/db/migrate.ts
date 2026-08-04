import { migrate } from "drizzle-orm/node-postgres/migrator";
import { pathToFileURL } from "node:url";
import { closeDatabase, getDb, getPool } from "@/server/db/client";
import { logger } from "@/server/logger";

// Arbitrary fixed key for a session-level Postgres advisory lock. Concurrent
// deploys (e.g. two Vercel builds landing close together) each block here
// until the other finishes, instead of racing DDL against the same database.
// The lock is released automatically if the holding connection ever drops,
// so a crashed build can never leave it stuck.
const MIGRATION_LOCK_KEY = 5_930_214_871_002n;

export async function runMigrations(): Promise<void> {
  const lockClient = await getPool().connect();
  try {
    logger.info("Waiting for the database migration lock");
    await lockClient.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    logger.info("Applying database migrations");
    await migrate(getDb(), { migrationsFolder: "drizzle" });
    logger.info("Database migrations complete");
  } finally {
    await lockClient.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    lockClient.release();
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  runMigrations()
    .catch((error: unknown) => {
      logger.error({ err: error }, "Database migration failed");
      process.exitCode = 1;
    })
    .finally(closeDatabase);
}
