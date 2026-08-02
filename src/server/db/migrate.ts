import { migrate } from "drizzle-orm/node-postgres/migrator";
import { pathToFileURL } from "node:url";
import { closeDatabase, getDb } from "@/server/db/client";
import { logger } from "@/server/logger";

export async function runMigrations(): Promise<void> {
  logger.info("Applying database migrations");
  await migrate(getDb(), { migrationsFolder: "drizzle" });
  logger.info("Database migrations complete");
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
