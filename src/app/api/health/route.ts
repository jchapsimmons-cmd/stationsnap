import { sql } from "drizzle-orm";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { getDb } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const startedAt = Date.now();

  try {
    await getDb().execute(sql`select 1`);
    return successResponse({
      status: "healthy",
      database: "connected",
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    return errorResponse(
      new AppError("SERVICE_UNAVAILABLE", "Application dependencies are unavailable.", {
        cause: error,
      }),
    );
  }
}
