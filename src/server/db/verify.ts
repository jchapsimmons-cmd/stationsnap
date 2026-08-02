import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { closeDatabase, getPool } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { runSeed } from "@/server/db/seed";

const port = 55_439;
const database = "stationsnap_verify";
const user = "postgres";
const password = "stationsnap-local-verification";

const postgres = new EmbeddedPostgres({
  databaseDir: path.resolve(".tmp", "postgres-phase1"),
  port,
  user,
  password,
  persistent: false,
  onLog: () => undefined,
});

async function verifyDatabase(): Promise<void> {
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase(database);

  process.env["DATABASE_URL"] = `postgresql://${user}:${password}@localhost:${port}/${database}`;
  process.env["LOG_LEVEL"] = "silent";

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

  process.stdout.write(`Database verified: ${JSON.stringify(counts)}\n`);
}

verifyDatabase()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
    await postgres.stop();
  });
