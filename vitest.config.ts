import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Explicitly setting `exclude` replaces Vitest's own default list rather than extending it, so
    // this repeats those defaults (node_modules, dist, .git, cache dirs) alongside two additions:
    // .next/** (a `next build` output tree that can vendor third-party packages with their own
    // test files, e.g. pino's, which Vitest would otherwise happily try to run) and e2e/** (holds
    // Playwright specs, run separately via `npm run test:e2e`, not Vitest ones — without excluding
    // it Vitest's default include pattern also picks up e2e/tests/*.spec.ts and fails them outright
    // since they depend on Playwright's own test runner and env wiring).
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.git/**",
      "**/.cache/**",
      "**/e2e/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
