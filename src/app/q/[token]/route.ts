import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { EMPLOYEE_SESSION_COOKIE } from "@/server/auth/constants";
import { getRequestFingerprint } from "@/server/auth/request-security";
import {
  clearEmployeeSessionCookie,
  getCurrentEmployeeSession,
  revokeEmployeeSession,
} from "@/server/auth/sessions";
import { resolveQrCode } from "@/server/qr/service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const { ipHash } = getRequestFingerprint(request);
  const session = await getCurrentEmployeeSession();
  const resolution = await resolveQrCode(token, { ipHash, employeeId: session?.employeeId });

  if (resolution.status !== "resolved") {
    return NextResponse.redirect(new URL("/q/invalid", request.url));
  }

  if (
    session &&
    session.organizationId === resolution.organizationId &&
    session.locationId === resolution.locationId
  ) {
    return NextResponse.redirect(new URL(resolution.destinationPath, request.url));
  }

  const loginUrl = new URL("/employee/login", request.url);
  loginUrl.searchParams.set("organization", resolution.organizationSlug);
  loginUrl.searchParams.set("location", resolution.locationSlug);
  loginUrl.searchParams.set("returnTo", resolution.destinationPath);
  const response = NextResponse.redirect(loginUrl);

  if (session) {
    const rawToken = (await cookies()).get(EMPLOYEE_SESSION_COOKIE)?.value;
    if (rawToken) await revokeEmployeeSession(rawToken);
    clearEmployeeSessionCookie(response);
  }

  return response;
}
