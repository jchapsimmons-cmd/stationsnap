import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { passwordResetConfirmSchema } from "@/server/auth/schemas";
import { completeManagerPasswordReset } from "@/server/auth/service";

export async function POST(request: Request): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const input = parseInput(passwordResetConfirmSchema, await readJson(request));
    await completeManagerPasswordReset(input, context.requestId);
    return successResponse({ message: "Password updated.", redirectTo: "/manager/login" });
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
