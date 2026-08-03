import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { sopRevisionOnlySchema } from "@/server/sops/schemas";
import { duplicateStep } from "@/server/sops/service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sopId: string; stepId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const input = parseInput(sopRevisionOnlySchema, await readJson(request));
    const { sopId, stepId } = await params;
    return successResponse(
      await duplicateStep(actor, sopId, stepId, input.expectedRevision, context.requestId),
      { status: 201 },
    );
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
