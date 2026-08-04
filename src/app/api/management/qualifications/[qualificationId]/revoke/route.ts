import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { qualificationRevokeSchema } from "@/server/training/paths-schemas";
import { revokeQualification } from "@/server/training/qualifications";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ qualificationId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const input = parseInput(qualificationRevokeSchema, await readJson(request));
    const { qualificationId } = await params;
    return successResponse(
      await revokeQualification(actor, qualificationId, input.note, context.requestId),
    );
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
