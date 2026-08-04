import { csvResponseInit } from "@/lib/csv";
import { errorResponse } from "@/lib/api-response";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { getRequestFingerprint } from "@/server/auth/request-security";
import { qualificationsReportToCsv, REPORT_EXPORT_MAX_ROWS } from "@/server/print/csv-export";
import { qualificationsReportQuerySchema } from "@/server/training/paths-schemas";
import { getQualificationsReport } from "@/server/training/qualifications";

/** CSV export mirroring `/manager/reports/qualifications`'s filters and authorization. */
export async function GET(request: Request): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const actor = await requireManager(context.requestId);
    const url = new URL(request.url);
    const filters = parseInput(
      qualificationsReportQuerySchema.omit({ page: true, pageSize: true }),
      {
        locationId: url.searchParams.get("locationId") ?? undefined,
        tab: url.searchParams.get("tab") ?? undefined,
      },
    );
    const { items } = await getQualificationsReport(actor, {
      ...filters,
      page: 1,
      pageSize: REPORT_EXPORT_MAX_ROWS,
    });
    return new Response(qualificationsReportToCsv(items), csvResponseInit("qualifications.csv"));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
