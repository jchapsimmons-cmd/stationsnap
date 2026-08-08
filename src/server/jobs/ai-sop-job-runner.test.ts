import { describe, expect, it } from "vitest";
import { backoffMs } from "@/server/jobs/ai-sop-job-runner";

// The full claim/advance/retry state machine needs a real database and is covered end-to-end in
// src/server/db/verify.ts (the same split every other phase's job/state-machine logic uses:
// pure calculations get a focused vitest unit, DB-backed behavior gets a db:verify regression).
describe("Phase 20 AI job runner backoff", () => {
  it("grows exponentially with each attempt", () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(3)).toBe(240_000);
  });

  it("caps at 15 minutes", () => {
    expect(backoffMs(20)).toBe(15 * 60_000);
  });

  it("never returns less than the first-attempt delay for non-positive input", () => {
    expect(backoffMs(0)).toBe(60_000);
    expect(backoffMs(-3)).toBe(60_000);
  });
});
