import { describe, expect, it } from "vitest";
import {
  checklistApprovalDecisionSchema,
  checklistCreateSchema,
  checklistItemActionSchema,
  checklistItemEvidenceUploadFormSchema,
  checklistItemNoteSchema,
  checklistQuerySchema,
  checklistRunQuerySchema,
  checklistRunSubmitSchema,
  checklistUpdateSchema,
} from "@/server/checklists/schemas";

describe("Phase 12 checklist create schema", () => {
  it("accepts a minimal checklist and defaults recurrence, status, and item flags", () => {
    const result = checklistCreateSchema.parse({
      title: "Closing checklist",
      type: "closing",
      locationId: crypto.randomUUID(),
      items: [{ title: "Clean the grill" }],
    });
    expect(result.recurrenceType).toBe("once");
    expect(result.status).toBe("active");
    expect(result.stationId).toBeNull();
    expect(result.items[0]?.isRequired).toBe(true);
    expect(result.items[0]?.timerSeconds).toBeNull();
    expect(result.items[0]?.requirePhoto).toBe(false);
  });

  it("coerces an empty stationId to null", () => {
    const result = checklistCreateSchema.parse({
      title: "Opening checklist",
      type: "opening",
      locationId: crypto.randomUUID(),
      stationId: "",
      items: [{ title: "Unlock the walk-in" }],
    });
    expect(result.stationId).toBeNull();
  });

  it("accepts a timer and evidence/approval/note requirements on an item", () => {
    const result = checklistCreateSchema.parse({
      title: "Prep checklist",
      type: "prep",
      locationId: crypto.randomUUID(),
      items: [
        {
          title: "Portion the patties",
          timerSeconds: 90,
          requirePhoto: true,
          requireApproval: true,
          requireNote: true,
        },
      ],
    });
    expect(result.items[0]?.timerSeconds).toBe(90);
    expect(result.items[0]?.requirePhoto).toBe(true);
    expect(result.items[0]?.requireApproval).toBe(true);
    expect(result.items[0]?.requireNote).toBe(true);
  });

  it("rejects an empty item list", () => {
    expect(() =>
      checklistCreateSchema.parse({
        title: "Empty checklist",
        type: "custom",
        locationId: crypto.randomUUID(),
        items: [],
      }),
    ).toThrow();
  });

  it("rejects an item list beyond the maximum", () => {
    expect(() =>
      checklistCreateSchema.parse({
        title: "Huge checklist",
        type: "custom",
        locationId: crypto.randomUUID(),
        items: Array.from({ length: 101 }, (_, index) => ({ title: `Item ${index}` })),
      }),
    ).toThrow();
  });

  it("rejects a timer outside the allowed range", () => {
    expect(() =>
      checklistCreateSchema.parse({
        title: "Bad timer",
        type: "custom",
        locationId: crypto.randomUUID(),
        items: [{ title: "Too long", timerSeconds: 10_000 }],
      }),
    ).toThrow();
  });

  it("rejects an invalid checklist type", () => {
    expect(() =>
      checklistCreateSchema.parse({
        title: "Invalid type",
        type: "not-a-type",
        locationId: crypto.randomUUID(),
        items: [{ title: "Item" }],
      }),
    ).toThrow();
  });
});

describe("Phase 12 checklist update schema", () => {
  it("accepts items carrying an existing id alongside new items without one", () => {
    const existingId = crypto.randomUUID();
    const result = checklistUpdateSchema.parse({
      title: "Updated checklist",
      type: "cleaning",
      items: [{ id: existingId, title: "Existing item" }, { title: "New item" }],
    });
    expect(result.items[0]?.id).toBe(existingId);
    expect(result.items[1]?.id).toBeUndefined();
  });
});

describe("Phase 12 checklist query schemas", () => {
  it("defaults checklist query filters to unset", () => {
    const result = checklistQuerySchema.parse({});
    expect(result).toEqual({ locationId: "", status: "", type: "" });
  });

  it("defaults run query filters to unset", () => {
    const result = checklistRunQuerySchema.parse({});
    expect(result).toEqual({ locationId: "", status: "" });
  });
});

describe("Phase 12 checklist item action schema", () => {
  it("accepts each allowed action with a positive expected revision", () => {
    for (const action of ["ticked", "unticked", "timer_completed"] as const) {
      const result = checklistItemActionSchema.parse({ action, expectedRevision: 1 });
      expect(result.action).toBe(action);
    }
  });

  it("rejects an unknown action", () => {
    expect(() =>
      checklistItemActionSchema.parse({ action: "confirmed", expectedRevision: 1 }),
    ).toThrow();
  });

  it("rejects a non-positive expected revision", () => {
    expect(() => checklistItemActionSchema.parse({ action: "ticked", expectedRevision: 0 })).toThrow();
  });
});

describe("Phase 12 checklist item note and evidence schemas", () => {
  it("defaults the note to an empty string", () => {
    const result = checklistItemNoteSchema.parse({ expectedRevision: 1 });
    expect(result.employeeNote).toBe("");
  });

  it("trims and bounds the note length", () => {
    expect(() =>
      checklistItemNoteSchema.parse({ employeeNote: "x".repeat(501), expectedRevision: 1 }),
    ).toThrow();
  });

  it("defaults evidence upload note to an empty string", () => {
    const result = checklistItemEvidenceUploadFormSchema.parse({ expectedRevision: 1 });
    expect(result.employeeNote).toBe("");
  });
});

describe("Phase 12 checklist run submit schema", () => {
  it("requires an expected revision", () => {
    expect(() => checklistRunSubmitSchema.parse({})).toThrow();
    expect(checklistRunSubmitSchema.parse({ expectedRevision: 3 }).expectedRevision).toBe(3);
  });
});

describe("Phase 12 checklist approval decision schema", () => {
  it("allows an empty note on approval", () => {
    const result = checklistApprovalDecisionSchema.parse({ decision: "approved" });
    expect(result.note).toBe("");
  });

  it("requires a non-empty note to reject", () => {
    expect(() => checklistApprovalDecisionSchema.parse({ decision: "rejected", note: "" })).toThrow();
    expect(
      checklistApprovalDecisionSchema.parse({ decision: "rejected", note: "Missed a spot." }).note,
    ).toBe("Missed a spot.");
  });

  it("requires a non-empty note to request a correction", () => {
    expect(() =>
      checklistApprovalDecisionSchema.parse({ decision: "needs_correction", note: "" }),
    ).toThrow();
  });
});
