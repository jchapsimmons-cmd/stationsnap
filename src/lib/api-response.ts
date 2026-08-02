import { NextResponse } from "next/server";
import { AppError, toAppError } from "@/lib/errors";
import { logger } from "@/server/logger";

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: {
    code: AppError["code"];
    message: string;
    details?: Readonly<Record<string, unknown>>;
  };
}

export function successResponse<T>(data: T, init?: ResponseInit): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ ok: true, data }, init);
}

export function errorResponse(error: unknown, requestId?: string): NextResponse<ApiFailure> {
  const appError = toAppError(error);

  if (appError.status >= 500) {
    logger.error(
      {
        code: appError.code,
        status: appError.status,
        requestId,
        errorType: error instanceof Error ? error.name : typeof error,
      },
      "Unhandled request error",
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.details ? { details: appError.details } : {}),
      },
    },
    {
      status: appError.status,
      headers: requestId ? { "x-request-id": requestId } : undefined,
    },
  );
}
