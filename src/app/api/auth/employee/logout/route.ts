import { cookies } from "next/headers";
import { errorResponse, successResponse } from "@/lib/api-response";
import { writeAuditEvent } from "@/server/audit";
import { EMPLOYEE_SESSION_COOKIE } from "@/server/auth/constants";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import {
  clearEmployeeSessionCookie,
  getEmployeeSession,
  revokeEmployeeSession,
} from "@/server/auth/sessions";

export async function POST(request: Request): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const token = (await cookies()).get(EMPLOYEE_SESSION_COOKIE)?.value;
    const session = token ? await getEmployeeSession(token) : null;
    if (token) await revokeEmployeeSession(token);
    if (session) {
      await writeAuditEvent({
        organizationId: session.organizationId,
        locationId: session.locationId,
        actorKind: "employee",
        actorId: session.employeeId,
        action: "session.logout",
        targetType: "employee_session",
        targetId: session.sessionId,
        requestId: context.requestId,
      });
    }
    const response = successResponse({ redirectTo: "/employee/access" });
    clearEmployeeSessionCookie(response);
    return response;
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
