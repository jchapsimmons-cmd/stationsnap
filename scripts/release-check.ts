import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { closeDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { parseSeedEnv, parseServerEnv, resetEnvCacheForTests } from "@/lib/env";

/**
 * Phase 19 production-like release verification. Unlike `npm run db:verify` (which seeds demo
 * data and exercises business logic) and `npm run test:e2e` (which drives the seeded app through
 * a browser), this script proves the *deployment path itself* against a NODE_ENV=production
 * configuration shaped like the real Vercel/Neon/Blob setup: strict env validation, a migration
 * from an empty database with no seed step (seeding is rejected outright in production, the same
 * "no test credentials/data" guarantee `src/lib/env.ts`'s `parseSeedEnv` enforces), a real
 * `next build` + `next start`, and a boot-time smoke check against the freshly migrated,
 * deliberately unseeded database. A production `BLOB_READ_WRITE_TOKEN` is not available in this
 * environment, so a syntactically valid placeholder satisfies env validation; no storage
 * operation is exercised here (upload/download paths already have driver and route coverage in
 * `npm run db:verify` and the unit suite).
 *
 * Kept out of `npm run verify` for the same reason `test:e2e` is: a full build-and-boot cycle is
 * a per-release gate, not a per-change one. Run with `npm run release:check`.
 */

const dbPort = 55_441;
const database = "stationsnap_release_check";
const dbUser = "postgres";
const dbPassword = randomBytes(24).toString("base64url");
const appPort = Number(process.env["RELEASE_CHECK_APP_PORT"] ?? 4320);
const appHost = "localhost";
const appUrl = `http://${appHost}:${appPort}`;

const nextBin = path.resolve("node_modules", ".bin", "next");

const postgres = new EmbeddedPostgres({
  databaseDir: path.resolve(".tmp", "postgres-release-check"),
  port: dbPort,
  user: dbUser,
  password: dbPassword,
  persistent: false,
  onLog: () => undefined,
  // See the matching comment in src/server/db/verify.ts and e2e/run.ts: lets this run as root
  // in CI/agent containers, where PostgreSQL's own initdb otherwise refuses to run.
  createPostgresUser: true,
});

function runToCompletion(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
    child.on("error", reject);
  });
}

function spawnLongRunning(command: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(command, args, { stdio: "inherit", env });
}

async function waitForHealth(deadlineMs: number): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${appUrl}/api/health`);
      if (response.ok) return;
    } catch (error: unknown) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(`The application never reported healthy at ${appUrl}/api/health${detail}`);
}

async function assertOk(pathname: string): Promise<void> {
  const response = await fetch(`${appUrl}${pathname}`);
  if (!response.ok) {
    throw new Error(`GET ${pathname} returned ${response.status} on a fresh, unseeded database`);
  }
}

function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 5_000);
  });
}

async function main(): Promise<void> {
  let server: ChildProcess | undefined;
  try {
    const productionEnv: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: `postgresql://${dbUser}:${dbPassword}@localhost:${dbPort}/${database}`,
      LOG_LEVEL: "silent",
      NODE_ENV: "production",
      APP_URL: `https://release-check.invalid`,
      STORAGE_DRIVER: "vercel-blob",
      // Syntactically valid placeholder only — no storage operation is exercised in this check.
      BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_release_check_placeholder_token",
      // Deliberately absent: SEED_MANAGER_PASSWORD / SEED_EMPLOYEE_PIN. parseSeedEnv rejects
      // NODE_ENV=production outright below, and a real production deploy never runs db:seed.
    };
    delete productionEnv["SEED_MANAGER_PASSWORD"];
    delete productionEnv["SEED_EMPLOYEE_PIN"];

    process.stdout.write("[release-check] Validating the production environment shape...\n");
    parseServerEnv(productionEnv);
    let seedRejected = false;
    try {
      parseSeedEnv(productionEnv);
    } catch {
      seedRejected = true;
    }
    if (!seedRejected) {
      throw new Error("Seed credentials were accepted under NODE_ENV=production");
    }

    Object.assign(process.env, productionEnv);
    resetEnvCacheForTests();

    process.stdout.write("[release-check] Starting an embedded PostgreSQL instance...\n");
    await postgres.initialise();
    await postgres.start();
    await postgres.createDatabase(database);

    process.stdout.write("[release-check] Migrating an empty database (no seed step)...\n");
    await runMigrations();
    await closeDatabase();

    process.stdout.write("[release-check] Building the app with NODE_ENV=production...\n");
    await runToCompletion(nextBin, ["build"], process.env);

    process.stdout.write(`[release-check] Starting the app on ${appUrl}...\n`);
    server = spawnLongRunning(
      nextBin,
      ["start", "-p", String(appPort), "-H", appHost],
      process.env,
    );
    await waitForHealth(60_000);
    await assertOk("/");

    process.stdout.write(
      "[release-check] Healthy: production config validated, migrated from empty with no seed data, built, booted, and smoke-checked.\n",
    );
  } finally {
    await stopChild(server);
    await postgres.stop();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
