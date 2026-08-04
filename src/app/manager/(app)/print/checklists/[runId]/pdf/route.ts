import { errorResponse } from "@/lib/api-response";
import { requireManager } from "@/server/auth/authorization";
import { getRequestFingerprint } from "@/server/auth/request-security";
import { getChecklistRunDetail } from "@/server/checklists/runs";
import { renderChecklistRunPdf } from "@/server/print/pdf";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const actor = await requireManager(context.requestId);
    const { runId } = await params;
    const detail = await getChecklistRunDetail(actor, runId);
    const bytes = await renderChecklistRunPdf({
      checklistTitle: detail.checklistTitle,
      checklistType: detail.checklistType,
      employeeName: detail.employeeName,
      employeeNumber: detail.employeeNumber,
      locationName: detail.locationName,
      status: detail.status,
      startedAt: detail.startedAt,
      submittedAt: detail.submittedAt,
      completedAt: detail.completedAt,
      items: detail.items.map((item) => ({
        displayOrder: item.displayOrder,
        title: item.title,
        isRequired: item.isRequired,
        isDone: item.isDone,
        employeeNote: item.employeeNote,
      })),
    });
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-length": String(bytes.byteLength),
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="checklist-run-${detail.id}.pdf"`,
      },
    });
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
