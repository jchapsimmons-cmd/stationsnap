import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { closeDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { runSeed } from "@/server/db/seed";

/**
 * Orchestrates the Phase 18 browser E2E suite, mirroring `src/server/db/verify.ts`'s own pattern
 * for standing up an isolated embedded PostgreSQL instance: migrate an empty database, seed it,
 * then exercise the real app through it. This script additionally builds and starts the real
 * Next.js app against that database (Playwright never gets its own mocked backend) and only then
 * runs Playwright, across every viewport project in `e2e/playwright.config.ts`, tearing everything
 * down afterward regardless of outcome.
 *
 * A dedicated port and database name (distinct from `db:verify`'s) let `npm run test:e2e` run
 * concurrently with `npm run verify` without colliding.
 */

const dbPort = 55_440;
const database = "stationsnap_e2e";
const dbUser = "postgres";
const dbPassword = randomBytes(24).toString("base64url");
const appPort = Number(process.env["E2E_APP_PORT"] ?? 4310);
// Next.js's own request-URL construction inside route handlers (e.g. the `new URL(path,
// request.url)` redirects in src/app/q/[token]/route.ts) normalizes the host to "localhost"
// under `next start` regardless of the Host header a client actually sent or which interface
// `-H` bound to. Using "localhost" everywhere here — bind host, advertised APP_URL, and (by
// default) Playwright's baseURL — keeps every origin the browser ever sees consistent, which
// matters because a QR scan's absolute redirect chain must stay on one origin for the employee
// session cookie it sets to still be readable by Playwright's later same-origin navigations.
const appHost = "localhost";
const appUrl = `http://${appHost}:${appPort}`;
const managerPassword = randomBytes(18).toString("base64url");
const employeePin = "9042";

const nextBin = path.resolve("node_modules", ".bin", "next");
const playwrightBin = path.resolve("node_modules", ".bin", "playwright");

const postgres = new EmbeddedPostgres({
  databaseDir: path.resolve(".tmp", "postgres-e2e"),
  port: dbPort,
  user: dbUser,
  password: dbPassword,
  persistent: false,
  onLog: () => undefined,
  // See the matching comment in src/server/db/verify.ts: lets this run as root in CI/agent
  // containers, where PostgreSQL's own initdb otherwise refuses to run.
  createPostgresUser: true,
});

function runToCompletion(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
    child.on("error", reject);
  });
}

function spawnLongRunning(command: string, args: string[]): ChildProcess {
  return spawn(command, args, { stdio: "inherit" });
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
    Object.assign(process.env, {
      DATABASE_URL: `postgresql://${dbUser}:${dbPassword}@localhost:${dbPort}/${database}`,
      LOG_LEVEL: "silent",
      NODE_ENV: "test",
      SEED_MANAGER_PASSWORD: managerPassword,
      SEED_EMPLOYEE_PIN: employeePin,
      APP_URL: appUrl,
      MEDIA_STORAGE_DIR: ".tmp/e2e-uploads",
      STORAGE_DRIVER: "local",
      E2E_APP_URL: appUrl,
      E2E_MANAGER_PASSWORD: managerPassword,
    });

    process.stdout.write("[e2e] Starting an embedded PostgreSQL instance...\n");
    await postgres.initialise();
    await postgres.start();
    await postgres.createDatabase(database);
    await runMigrations();
    await runSeed();
    await closeDatabase();

    process.stdout.write("[e2e] Building the app for a production-like run...\n");
    await runToCompletion(nextBin, ["build"]);

    process.stdout.write(`[e2e] Starting the app on ${appUrl}...\n`);
    server = spawnLongRunning(nextBin, ["start", "-p", String(appPort), "-H", appHost]);
    await waitForHealth(60_000);

    process.stdout.write("[e2e] Running the critical-path suite across every viewport...\n");
    await runToCompletion(playwrightBin, ["test", "--config", "e2e/playwright.config.ts"]);

    process.stdout.write("[e2e] Passed on every required viewport.\n");
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
