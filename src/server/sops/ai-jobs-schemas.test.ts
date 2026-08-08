import { describe, expect, it } from "vitest";
import { applyAiJobOutputSchema, createVideoDraftJobSchema } from "@/server/sops/ai-jobs-schemas";

describe("Phase 20 AI job input schemas", () => {
  it("accepts a valid source file id", () => {
    const id = crypto.randomUUID();
    expect(createVideoDraftJobSchema.parse({ sourceFileId: id })).toEqual({ sourceFileId: id });
  });

  it("rejects a non-uuid source file id", () => {
    expect(() => createVideoDraftJobSchema.parse({ sourceFileId: "not-a-uuid" })).toThrow();
  });

  it("rejects a missing source file id", () => {
    expect(() => createVideoDraftJobSchema.parse({})).toThrow();
  });

  it("accepts a valid output id for apply/dismiss", () => {
    const id = crypto.randomUUID();
    expect(applyAiJobOutputSchema.parse({ outputId: id })).toEqual({ outputId: id });
  });

  it("rejects a non-uuid output id", () => {
    expect(() => applyAiJobOutputSchema.parse({ outputId: "not-a-uuid" })).toThrow();
  });
});
