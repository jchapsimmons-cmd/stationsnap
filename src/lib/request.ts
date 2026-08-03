import { AppError } from "@/lib/errors";

export async function readJson(request: Request, maxBytes = 32_768): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new AppError("BAD_REQUEST", "This endpoint requires a JSON request.");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new AppError("BAD_REQUEST", "The request is too large.");
  }
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > maxBytes) {
    throw new AppError("BAD_REQUEST", "The request is too large.");
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new AppError("BAD_REQUEST", "The request body is not valid JSON.");
  }
}
