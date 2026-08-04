import { describe, expect, it } from "vitest";
import {
  trainingAnswerSubmitSchema,
  trainingAssignmentCreateSchema,
  trainingEvidenceUploadFormSchema,
  trainingSessionSubmitSchema,
  trainingStepActionSchema,
} from "@/server/training/schemas";

describe("Phase 8 training session schemas", () => {
  it("accepts a minimal assignment request and defaults the mode to unset", () => {
    const result = trainingAssignmentCreateSchema.parse({
      employeeId: crypto.randomUUID(),
      sopId: crypto.randomUUID(),
    });
    expect(result.requiredMode).toBeUndefined();
  });

  it("rejects an invalid required mode", () => {
    expect(() =>
      trainingAssignmentCreateSchema.parse({
        employeeId: crypto.randomUUID(),
        sopId: crypto.randomUUID(),
        requiredMode: "expert",
      }),
    ).toThrow();
  });

  it("rejects a malformed employee or SOP id", () => {
    expect(() =>
      trainingAssignmentCreateSchema.parse({
        employeeId: "not-a-uuid",
        sopId: crypto.randomUUID(),
      }),
    ).toThrow();
  });

  it("accepts every known step action", () => {
    for (const action of ["viewed", "confirmed", "video_watched", "timer_completed"]) {
      expect(() => trainingStepActionSchema.parse({ action, expectedRevision: 1 })).not.toThrow();
    }
  });

  it("rejects an unknown step action", () => {
    expect(() =>
      trainingStepActionSchema.parse({ action: "skipped", expectedRevision: 1 }),
    ).toThrow();
  });

  it("requires a positive integer revision", () => {
    expect(() =>
      trainingStepActionSchema.parse({ action: "confirmed", expectedRevision: 0 }),
    ).toThrow();
  });

  it("requires at least one selected choice for an answer", () => {
    expect(() =>
      trainingAnswerSubmitSchema.parse({ selectedChoiceIds: [], expectedRevision: 1 }),
    ).toThrow();
  });

  it("accepts a bounded number of selected choices", () => {
    const result = trainingAnswerSubmitSchema.parse({
      selectedChoiceIds: [crypto.randomUUID(), crypto.randomUUID()],
      expectedRevision: 1,
    });
    expect(result.selectedChoiceIds).toHaveLength(2);
  });

  it("defaults the evidence note to an empty string and bounds its length", () => {
    const result = trainingEvidenceUploadFormSchema.parse({ expectedRevision: 1 });
    expect(result.employeeNote).toBe("");
    expect(() =>
      trainingEvidenceUploadFormSchema.parse({
        employeeNote: "a".repeat(501),
        expectedRevision: 1,
      }),
    ).toThrow();
  });

  it("requires an expected revision to submit a session", () => {
    expect(() => trainingSessionSubmitSchema.parse({})).toThrow();
    expect(trainingSessionSubmitSchema.parse({ expectedRevision: "2" }).expectedRevision).toBe(2);
  });
});
