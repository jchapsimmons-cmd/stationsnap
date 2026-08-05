import { errorResponse } from "@/lib/api-response";
import { requireManager } from "@/server/auth/authorization";
import { getRequestFingerprint } from "@/server/auth/request-security";
import { getMediaFile } from "@/server/storage/media-service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const actor = await requireManager(context.requestId);
    const { fileId } = await params;
    const media = await getMediaFile(actor, fileId);
    return new Response(new Uint8Array(media.buffer), {
      status: 200,
      headers: {
        "content-type": media.mimeType,
        "content-length": String(media.buffer.byteLength),
        "cache-control": "private, max-age=3600",
        "content-disposition": `inline; filename="${media.originalName.replace(/"/g, "")}"`,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
