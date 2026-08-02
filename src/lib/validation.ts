import { z } from "zod";
import { AppError } from "@/lib/errors";

export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new AppError("VALIDATION_ERROR", "Please correct the highlighted fields.", {
      details: {
        fields: result.error.flatten().fieldErrors,
      },
    });
  }

  return result.data;
}
