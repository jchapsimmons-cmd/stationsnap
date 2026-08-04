import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getServerEnv } from "@/lib/env";
import * as schema from "@/server/db/schema";
import { logger } from "@/server/logger";

interface DatabaseGlobal {
  pool?: Pool;
  db?: NodePgDatabase<typeof schema>;
}

const databaseGlobal = globalThis as typeof globalThis & DatabaseGlobal;

export function getPool(): Pool {
  if (!databaseGlobal.pool) {
    databaseGlobal.pool = new Pool({
      connectionString: getServerEnv().DATABASE_URL,
      max: process.env["NODE_ENV"] === "production" ? 10 : 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    // pg's Pool requires an error listener: without one, an idle client that hits a
    // connection-level error (for example the server shutting down) crashes the whole
    // process with an unhandled 'error' event instead of just dropping that connection.
    databaseGlobal.pool.on("error", (error: unknown) => {
      logger.error({ err: error }, "Idle database connection error");
    });
  }
  return databaseGlobal.pool;
}

export function getDb(): NodePgDatabase<typeof schema> {
  databaseGlobal.db ??= drizzle(getPool(), { schema });
  return databaseGlobal.db;
}

export async function closeDatabase(): Promise<void> {
  if (databaseGlobal.pool) {
    await databaseGlobal.pool.end();
    databaseGlobal.pool = undefined;
    databaseGlobal.db = undefined;
  }
}
