import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { managerLoginSchema } from "@/server/auth/schemas";
import {
  getRequestFingerprint,
  assertSameOrigin,
  safeReturnTo,
} from "@/server/auth/request-security";
import { loginManager } from "@/server/auth/service";
import { setManagerSessionCookie } from "@/server/auth/sessions";

export async function POST(request: Request): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const input = parseInput(managerLoginSchema, await readJson(request));
    const session = await loginManager(input, context);
    const response = successResponse({
      displayName: session.displayName,
      redirectTo: safeReturnTo(input.returnTo, "/manager"),
    });
    setManagerSessionCookie(response, session.token, session.expiresAt);
    return response;
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
