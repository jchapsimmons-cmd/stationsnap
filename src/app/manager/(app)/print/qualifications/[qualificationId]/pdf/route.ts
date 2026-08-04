import { errorResponse } from "@/lib/api-response";
import { requireManager } from "@/server/auth/authorization";
import { getRequestFingerprint } from "@/server/auth/request-security";
import { renderQualificationPdf } from "@/server/print/pdf";
import { getQualificationDetail } from "@/server/training/qualifications";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ qualificationId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const actor = await requireManager(context.requestId);
    const { qualificationId } = await params;
    const detail = await getQualificationDetail(actor, qualificationId);
    const bytes = await renderQualificationPdf({
      employeeName: detail.employeeName,
      employeeNumber: detail.employeeNumber,
      locationName: detail.locationName,
      definitionName: detail.definition.name,
      definitionDescription: detail.definition.description,
      pathTitle: detail.path.title,
      status: detail.status,
      awardedAt: detail.awardedAt,
      expiresAt: detail.expiresAt,
      isExpired: detail.isExpired,
      revokedAt: detail.revokedAt,
      revokedNote: detail.revokedNote,
      supportingSessions: detail.supportingSessions.map((row) => ({
        sopTitle: row.sopTitle,
        sopVersionNumber: row.sopVersionNumber,
        completedAt: row.completedAt,
      })),
    });
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-length": String(bytes.byteLength),
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="qualification-${detail.definition.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf"`,
      },
    });
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
