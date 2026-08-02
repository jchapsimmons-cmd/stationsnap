import { describe, expect, it } from "vitest";
import { AppError, toAppError } from "@/lib/errors";

describe("application errors", () => {
  it("maps domain error codes to stable HTTP status codes", () => {
    expect(new AppError("FORBIDDEN", "Not allowed").status).toBe(403);
    expect(new AppError("CONFLICT", "Already exists").status).toBe(409);
    expect(new AppError("VALIDATION_ERROR", "Invalid").status).toBe(422);
    expect(new AppError("SERVICE_UNAVAILABLE", "Unavailable").status).toBe(503);
  });

  it("does not expose unknown error messages", () => {
    const result = toAppError(new Error("database password leaked"));
    expect(result.code).toBe("INTERNAL_ERROR");
    expect(result.message).toBe("An unexpected error occurred.");
  });
});
