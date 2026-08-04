import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { translationMatrixQuerySchema, translationUpsertSchema } from "@/server/sops/schemas";
import { getTranslationMatrix, upsertTranslation } from "@/server/sops/translations";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sopId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const actor = await requireManager(context.requestId);
    const { sopId } = await params;
    const url = new URL(request.url);
    const query = parseInput(translationMatrixQuerySchema, {
      targetLocale: url.searchParams.get("targetLocale") ?? undefined,
    });
    return successResponse(await getTranslationMatrix(actor, sopId, query.targetLocale));
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
    const input = parseInput(translationUpsertSchema, await readJson(request));
    const { sopId } = await params;
    return successResponse(await upsertTranslation(actor, sopId, input, context.requestId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
