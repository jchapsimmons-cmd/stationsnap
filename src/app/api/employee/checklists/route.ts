import { errorResponse, successResponse } from "@/lib/api-response";
import { listChecklistsForEmployeeWithActiveRun } from "@/server/checklists/runs";
import { listChecklistsForEmployee } from "@/server/checklists/service";
import { requireEmployee } from "@/server/auth/authorization";
import { getRequestFingerprint } from "@/server/auth/request-security";

export async function GET(request: Request): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const session = await requireEmployee(context.requestId);
    const [checklists, activeRunsByChecklistId] = await Promise.all([
      listChecklistsForEmployee(session),
      listChecklistsForEmployeeWithActiveRun(session),
    ]);
    return successResponse(
      checklists.map((checklist) => ({
        ...checklist,
        activeRun: activeRunsByChecklistId.get(checklist.id) ?? null,
      })),
    );
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
