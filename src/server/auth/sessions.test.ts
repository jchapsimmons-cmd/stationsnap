import { NextResponse } from "next/server";
import { describe, expect, it } from "vitest";
import { EMPLOYEE_SESSION_COOKIE, MANAGER_SESSION_COOKIE } from "@/server/auth/constants";
import { setEmployeeSessionCookie, setManagerSessionCookie } from "@/server/auth/sessions";

describe("session cookies", () => {
  it("uses distinct manager and employee cookie names", () => {
    expect(MANAGER_SESSION_COOKIE).not.toBe(EMPLOYEE_SESSION_COOKIE);
  });

  it("sets manager sessions as HttpOnly and SameSite", () => {
    const response = NextResponse.json({ ok: true });
    setManagerSessionCookie(response, "manager-token", new Date(Date.now() + 60_000));
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${MANAGER_SESSION_COOKIE}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).not.toContain(`${EMPLOYEE_SESSION_COOKIE}=`);
  });

  it("sets employee sessions independently", () => {
    const response = NextResponse.json({ ok: true });
    setEmployeeSessionCookie(response, "employee-token", new Date(Date.now() + 60_000));
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${EMPLOYEE_SESSION_COOKIE}=`);
    expect(cookie).not.toContain(`${MANAGER_SESSION_COOKIE}=`);
  });
});
