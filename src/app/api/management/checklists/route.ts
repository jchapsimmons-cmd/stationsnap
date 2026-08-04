import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { checklistCreateSchema, checklistQuerySchema } from "@/server/checklists/schemas";
import { createChecklist, listChecklists } from "@/server/checklists/service";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";

export async function GET(request: Request): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const actor = await requireManager(context.requestId);
    const url = new URL(request.url);
    const input = parseInput(checklistQuerySchema, {
      locationId: url.searchParams.get("locationId") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      type: url.searchParams.get("type") ?? undefined,
    });
    return successResponse(await listChecklists(actor, input));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}

export async function POST(request: Request): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const input = parseInput(checklistCreateSchema, await readJson(request));
    return successResponse(await createChecklist(actor, input, context.requestId), { status: 201 });
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
