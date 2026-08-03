import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { passwordResetRequestSchema } from "@/server/auth/schemas";
import { requestManagerPasswordReset } from "@/server/auth/service";

export async function POST(request: Request): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const input = parseInput(passwordResetRequestSchema, await readJson(request));
    await requestManagerPasswordReset(input.email, context.requestId);
    return successResponse({ message: "If that account is active, a reset link has been sent." });
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
