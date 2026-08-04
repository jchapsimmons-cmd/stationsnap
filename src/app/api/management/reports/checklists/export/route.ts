import { csvResponseInit } from "@/lib/csv";
import { errorResponse } from "@/lib/api-response";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { getRequestFingerprint } from "@/server/auth/request-security";
import { checklistCompletionReportQuerySchema } from "@/server/checklists/schemas";
import { getChecklistCompletionReport } from "@/server/checklists/runs";
import { checklistCompletionReportToCsv, REPORT_EXPORT_MAX_ROWS } from "@/server/print/csv-export";

/** CSV export mirroring `/manager/reports/checklists`'s filters and authorization. */
export async function GET(request: Request): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const actor = await requireManager(context.requestId);
    const url = new URL(request.url);
    const filters = parseInput(
      checklistCompletionReportQuerySchema.omit({ page: true, pageSize: true }),
      {
        locationId: url.searchParams.get("locationId") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
        search: url.searchParams.get("search") ?? undefined,
      },
    );
    const { items } = await getChecklistCompletionReport(actor, {
      ...filters,
      page: 1,
      pageSize: REPORT_EXPORT_MAX_ROWS,
    });
    return new Response(
      checklistCompletionReportToCsv(items),
      csvResponseInit("checklist-completion.csv"),
    );
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
