import { errorResponse } from "@/lib/api-response";
import { requireManager } from "@/server/auth/authorization";
import { getRequestFingerprint } from "@/server/auth/request-security";
import { renderTrainingSessionPdf } from "@/server/print/pdf";
import { getTrainingSessionForPrint } from "@/server/training/service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const actor = await requireManager(context.requestId);
    const { sessionId } = await params;
    const record = await getTrainingSessionForPrint(actor, sessionId);
    const bytes = await renderTrainingSessionPdf(record);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-length": String(bytes.byteLength),
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="training-attempt-${record.attemptNumber}.pdf"`,
      },
    });
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
