import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { createVideoDraftJob, listAiJobsForSop } from "@/server/sops/ai-jobs";
import { createVideoDraftJobSchema } from "@/server/sops/ai-jobs-schemas";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sopId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const actor = await requireManager(context.requestId);
    const { sopId } = await params;
    return successResponse(await listAiJobsForSop(actor, sopId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sopId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const { sopId } = await params;
    const input = parseInput(createVideoDraftJobSchema, await readJson(request));
    return successResponse(await createVideoDraftJob(actor, sopId, input, context.requestId), {
      status: 201,
    });
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
