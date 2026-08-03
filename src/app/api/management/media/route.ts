import { errorResponse, successResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { VIDEO_MAX_BYTES } from "@/server/storage/constants";
import { uploadMedia } from "@/server/storage/media-service";

const REQUEST_CEILING_BYTES = VIDEO_MAX_BYTES + 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > REQUEST_CEILING_BYTES) {
      throw new AppError("BAD_REQUEST", "The upload exceeds the allowed size.");
    }
    const formData = await request.formData();
    return successResponse(await uploadMedia(actor, formData, context.requestId), {
      status: 201,
    });
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
