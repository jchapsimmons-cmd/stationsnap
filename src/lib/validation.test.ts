import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { parseInput } from "@/lib/validation";

describe("parseInput", () => {
  const schema = z.object({ name: z.string().trim().min(2) });

  it("returns typed and normalized input", () => {
    expect(parseInput(schema, { name: "  Grill  " })).toEqual({ name: "Grill" });
  });

  it("throws a structured validation error", () => {
    try {
      parseInput(schema, { name: "" });
      throw new Error("expected parseInput to fail");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("VALIDATION_ERROR");
      expect((error as AppError).details).toHaveProperty("fields");
    }
  });
});
