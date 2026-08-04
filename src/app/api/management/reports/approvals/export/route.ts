import { csvResponseInit } from "@/lib/csv";
import { errorResponse } from "@/lib/api-response";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { getRequestFingerprint } from "@/server/auth/request-security";
import { approvalHistoryReportQuerySchema } from "@/server/reports-schemas";
import { getApprovalHistoryReport } from "@/server/reports";
import { approvalHistoryReportToCsv, REPORT_EXPORT_MAX_ROWS } from "@/server/print/csv-export";

/** CSV export mirroring `/manager/reports/approvals`'s filters and authorization. */
export async function GET(request: Request): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const actor = await requireManager(context.requestId);
    const url = new URL(request.url);
    const filters = parseInput(
      approvalHistoryReportQuerySchema.omit({ page: true, pageSize: true }),
      {
        locationId: url.searchParams.get("locationId") ?? undefined,
        decision: url.searchParams.get("decision") ?? undefined,
      },
    );
    const { items } = await getApprovalHistoryReport(actor, {
      ...filters,
      page: 1,
      pageSize: REPORT_EXPORT_MAX_ROWS,
    });
    return new Response(approvalHistoryReportToCsv(items), csvResponseInit("approval-history.csv"));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
