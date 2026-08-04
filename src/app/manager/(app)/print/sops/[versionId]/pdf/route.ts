import { errorResponse } from "@/lib/api-response";
import { requireManager } from "@/server/auth/authorization";
import { getRequestFingerprint } from "@/server/auth/request-security";
import { renderSopVersionPdf } from "@/server/print/pdf";
import { getSopVersionForPrint } from "@/server/sops/service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const actor = await requireManager(context.requestId);
    const { versionId } = await params;
    const detail = await getSopVersionForPrint(actor, versionId);
    const bytes = await renderSopVersionPdf({
      sopTitle: detail.version.title,
      versionNumber: detail.version.versionNumber,
      status: detail.version.status,
      category: detail.category,
      difficulty: detail.version.difficulty,
      estimatedMinutes: detail.version.estimatedMinutes,
      changeSummary: detail.version.changeSummary,
      publishedAt: detail.version.publishedAt,
      locationName: detail.locationName,
      stationName: detail.stationName,
      materials: detail.materials,
      warnings: detail.warnings,
      steps: detail.steps,
    });
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-length": String(bytes.byteLength),
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="sop-v${detail.version.versionNumber}.pdf"`,
      },
    });
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
