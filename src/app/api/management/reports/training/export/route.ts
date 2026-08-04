import { csvResponseInit } from "@/lib/csv";
import { errorResponse } from "@/lib/api-response";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { getRequestFingerprint } from "@/server/auth/request-security";
import { trainingProgressReportToCsv, REPORT_EXPORT_MAX_ROWS } from "@/server/print/csv-export";
import { trainingProgressReportQuerySchema } from "@/server/training/schemas";
import { getTrainingProgressReport } from "@/server/training/service";

/** CSV export mirroring `/manager/reports/training`'s filters and authorization, bounded rather than paginated. */
export async function GET(request: Request): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const actor = await requireManager(context.requestId);
    const url = new URL(request.url);
    const filters = parseInput(
      trainingProgressReportQuerySchema.omit({ page: true, pageSize: true }),
      {
        status: url.searchParams.get("status") ?? undefined,
        locationId: url.searchParams.get("locationId") ?? undefined,
        search: url.searchParams.get("search") ?? undefined,
      },
    );
    const { items } = await getTrainingProgressReport(actor, {
      ...filters,
      page: 1,
      pageSize: REPORT_EXPORT_MAX_ROWS,
    });
    return new Response(
      trainingProgressReportToCsv(items),
      csvResponseInit("training-progress.csv"),
    );
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
