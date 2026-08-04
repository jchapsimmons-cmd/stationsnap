import { describe, expect, it } from "vitest";
import {
  trainingAnswerSubmitSchema,
  trainingAssignmentCreateSchema,
  trainingAssignmentQuerySchema,
  trainingEvidenceUploadFormSchema,
  trainingSessionSubmitSchema,
  trainingStepActionSchema,
} from "@/server/training/schemas";

describe("Phase 9 bulk training assignment schema", () => {
  it("accepts an employees target and defaults the mode and due date to unset", () => {
    const employeeId = crypto.randomUUID();
    const result = trainingAssignmentCreateSchema.parse({
      sopId: crypto.randomUUID(),
      target: { type: "employees", employeeIds: [employeeId] },
    });
    expect(result.requiredMode).toBeUndefined();
    expect(result.dueDate).toBeUndefined();
    expect(result.target).toEqual({ type: "employees", employeeIds: [employeeId] });
  });

  it("dedupes an employees target's id list", () => {
    const employeeId = crypto.randomUUID();
    const result = trainingAssignmentCreateSchema.parse({
      sopId: crypto.randomUUID(),
      target: { type: "employees", employeeIds: [employeeId, employeeId] },
    });
    if (result.target.type !== "employees") throw new Error("Expected an employees target");
    expect(result.target.employeeIds).toEqual([employeeId]);
  });

  it("rejects an empty employees id list", () => {
    expect(() =>
      trainingAssignmentCreateSchema.parse({
        sopId: crypto.randomUUID(),
        target: { type: "employees", employeeIds: [] },
      }),
    ).toThrow();
  });

  it("rejects an employees id list beyond the maximum", () => {
    expect(() =>
      trainingAssignmentCreateSchema.parse({
        sopId: crypto.randomUUID(),
        target: {
          type: "employees",
          employeeIds: Array.from({ length: 201 }, () => crypto.randomUUID()),
        },
      }),
    ).toThrow();
  });

  it("accepts a jobRoles target and dedupes role names", () => {
    const result = trainingAssignmentCreateSchema.parse({
      sopId: crypto.randomUUID(),
      target: { type: "jobRoles", jobRoles: ["Cook", "Cook", "Server"] },
    });
    if (result.target.type !== "jobRoles") throw new Error("Expected a jobRoles target");
    expect(result.target.jobRoles).toEqual(["Cook", "Server"]);
  });

  it("rejects a jobRoles target beyond the maximum", () => {
    expect(() =>
      trainingAssignmentCreateSchema.parse({
        sopId: crypto.randomUUID(),
        target: {
          type: "jobRoles",
          jobRoles: Array.from({ length: 21 }, (_, index) => `Role ${index}`),
        },
      }),
    ).toThrow();
  });

  it("accepts a location target with no additional fields", () => {
    const result = trainingAssignmentCreateSchema.parse({
      sopId: crypto.randomUUID(),
      target: { type: "location" },
    });
    expect(result.target).toEqual({ type: "location" });
  });

  it("rejects an unknown target type", () => {
    expect(() =>
      trainingAssignmentCreateSchema.parse({
        sopId: crypto.randomUUID(),
        target: { type: "station" },
      }),
    ).toThrow();
  });

  it("accepts a well-formed due date", () => {
    const result = trainingAssignmentCreateSchema.parse({
      sopId: crypto.randomUUID(),
      target: { type: "location" },
      dueDate: "2026-08-15",
    });
    expect(result.dueDate).toBe("2026-08-15");
  });

  it("rejects a malformed due date", () => {
    expect(() =>
      trainingAssignmentCreateSchema.parse({
        sopId: crypto.randomUUID(),
        target: { type: "location" },
        dueDate: "08/15/2026",
      }),
    ).toThrow();
  });

  it("rejects a due date that is not a real calendar date", () => {
    expect(() =>
      trainingAssignmentCreateSchema.parse({
        sopId: crypto.randomUUID(),
        target: { type: "location" },
        dueDate: "2026-02-30",
      }),
    ).toThrow();
  });

  it("rejects an invalid required mode", () => {
    expect(() =>
      trainingAssignmentCreateSchema.parse({
        sopId: crypto.randomUUID(),
        target: { type: "location" },
        requiredMode: "expert",
      }),
    ).toThrow();
  });

  it("rejects a malformed SOP id", () => {
    expect(() =>
      trainingAssignmentCreateSchema.parse({
        sopId: "not-a-uuid",
        target: { type: "location" },
      }),
    ).toThrow();
  });
});

describe("Training assignment query schema", () => {
  it("defaults status and location filters to unset", () => {
    const result = trainingAssignmentQuerySchema.parse({});
    expect(result.status).toBe("");
    expect(result.locationId).toBe("");
  });

  it("accepts every known status value", () => {
    for (const status of ["assigned", "in_progress", "completed", "failed", "cancelled"]) {
      expect(() => trainingAssignmentQuerySchema.parse({ status })).not.toThrow();
    }
  });

  it("rejects an unknown status value", () => {
    expect(() => trainingAssignmentQuerySchema.parse({ status: "archived" })).toThrow();
  });
});

describe("Phase 8 training session schemas", () => {
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
