import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import {
  assertSameOrigin,
  getRequestFingerprint,
  safeReturnTo,
} from "@/server/auth/request-security";
import { employeeLoginSchema } from "@/server/auth/schemas";
import { loginEmployee } from "@/server/auth/service";
import { setEmployeeSessionCookie } from "@/server/auth/sessions";

export async function POST(request: Request): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const input = parseInput(employeeLoginSchema, await readJson(request));
    const session = await loginEmployee(input, context);
    const response = successResponse({
      displayName: session.displayName,
      redirectTo: safeReturnTo(input.returnTo, "/employee"),
    });
    setEmployeeSessionCookie(response, session.token, session.expiresAt);
    return response;
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
