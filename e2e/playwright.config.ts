import { defineConfig } from "@playwright/test";

/**
 * `e2e/run.ts` is the entry point for this suite: it stands up an isolated embedded PostgreSQL
 * database, migrates and seeds it, builds and starts the app against it, and only then invokes
 * `playwright test --config e2e/playwright.config.ts`, passing the app's URL and a generated Owner
 * password through the environment. This config never starts its own dev server — do not run
 * `npx playwright test` directly against this config without an app already listening at
 * `E2E_APP_URL`; use `npm run test:e2e` instead.
 */
const baseURL = process.env["E2E_APP_URL"] ?? "http://127.0.0.1:4310";

export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  // The four representative viewports required by docs/testing-plan.md's E2E critical path
  // section: small phone, large phone, tablet, and desktop. Every project runs the same spec.
  projects: [
    { name: "small-phone", use: { viewport: { width: 360, height: 740 } } },
    { name: "large-phone", use: { viewport: { width: 414, height: 896 } } },
    { name: "tablet", use: { viewport: { width: 820, height: 1180 } } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
