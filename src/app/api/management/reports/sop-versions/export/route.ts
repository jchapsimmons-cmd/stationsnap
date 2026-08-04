import { csvResponseInit } from "@/lib/csv";
import { errorResponse } from "@/lib/api-response";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { getRequestFingerprint } from "@/server/auth/request-security";
import { sopVersionHistoryReportQuerySchema } from "@/server/sops/schemas";
import { getSopVersionHistoryReport } from "@/server/sops/service";
import { sopVersionHistoryReportToCsv, REPORT_EXPORT_MAX_ROWS } from "@/server/print/csv-export";

/** CSV export mirroring `/manager/reports/sop-versions`'s filters and authorization. */
export async function GET(request: Request): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const actor = await requireManager(context.requestId);
    const url = new URL(request.url);
    const filters = parseInput(
      sopVersionHistoryReportQuerySchema.omit({ page: true, pageSize: true }),
      {
        search: url.searchParams.get("search") ?? undefined,
        category: url.searchParams.get("category") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
        locationId: url.searchParams.get("locationId") ?? undefined,
      },
    );
    const { items } = await getSopVersionHistoryReport(actor, {
      ...filters,
      page: 1,
      pageSize: REPORT_EXPORT_MAX_ROWS,
    });
    return new Response(sopVersionHistoryReportToCsv(items), csvResponseInit("sop-versions.csv"));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
