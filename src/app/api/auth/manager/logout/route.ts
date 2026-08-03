import { cookies } from "next/headers";
import { errorResponse, successResponse } from "@/lib/api-response";
import { writeAuditEvent } from "@/server/audit";
import { MANAGER_SESSION_COOKIE } from "@/server/auth/constants";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import {
  clearManagerSessionCookie,
  getManagerSession,
  revokeManagerSession,
} from "@/server/auth/sessions";

export async function POST(request: Request): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const token = (await cookies()).get(MANAGER_SESSION_COOKIE)?.value;
    const session = token ? await getManagerSession(token) : null;
    if (token) await revokeManagerSession(token);
    if (session) {
      await writeAuditEvent({
        organizationId: session.organizationId,
        actorKind: "manager",
        actorId: session.managerUserId,
        action: "session.logout",
        targetType: "manager_session",
        targetId: session.sessionId,
        requestId: context.requestId,
      });
    }
    const response = successResponse({ redirectTo: "/manager/login" });
    clearManagerSessionCookie(response);
    return response;
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
