import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { translationDraftGenerateSchema } from "@/server/sops/schemas";
import {
  generateTranslationDraft,
  productionTranslationDraftDeps,
} from "@/server/sops/translations";

/**
 * A manager's explicit "generate with AI" action for one field/locale — never automatic, never
 * triggered on existing content in the background. See `generateTranslationDraft` in
 * `src/server/sops/translations.ts` for the schema-validation and never-overwrite-approved rules.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sopId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const input = parseInput(translationDraftGenerateSchema, await readJson(request));
    const { sopId } = await params;
    return successResponse(
      await generateTranslationDraft(
        actor,
        sopId,
        input,
        productionTranslationDraftDeps,
        context.requestId,
      ),
    );
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
