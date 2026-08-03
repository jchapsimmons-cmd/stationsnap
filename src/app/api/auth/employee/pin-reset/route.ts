import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { resetEmployeePin } from "@/server/auth/admin";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { pinResetSchema } from "@/server/auth/schemas";

export async function POST(request: Request): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const input = parseInput(pinResetSchema, await readJson(request));
    await resetEmployeePin(actor, input, context.requestId);
    return successResponse({ message: "Employee PIN updated." });
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
