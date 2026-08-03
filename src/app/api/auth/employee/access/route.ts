import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import {
  assertSameOrigin,
  getRequestFingerprint,
  safeReturnTo,
} from "@/server/auth/request-security";
import { employeeAccessSchema } from "@/server/auth/schemas";
import { resolveEmployeeAccess } from "@/server/auth/service";

export async function POST(request: Request): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const input = parseInput(employeeAccessSchema, await readJson(request));
    const access = await resolveEmployeeAccess(input);
    const params = new URLSearchParams({
      organization: input.organizationSlug,
      location: input.locationSlug,
      returnTo: safeReturnTo(input.returnTo, "/employee"),
    });
    return successResponse({
      organizationName: access.organizationName,
      locationName: access.locationName,
      redirectTo: `/employee/login?${params.toString()}`,
    });
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
