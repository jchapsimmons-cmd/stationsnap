import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { applyAiJobOutput } from "@/server/sops/ai-jobs";
import { applyAiJobOutputSchema } from "@/server/sops/ai-jobs-schemas";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sopId: string; jobId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const { sopId, jobId } = await params;
    const input = parseInput(applyAiJobOutputSchema, await readJson(request));
    return successResponse(
      await applyAiJobOutput(actor, sopId, jobId, input.outputId, context.requestId),
    );
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
