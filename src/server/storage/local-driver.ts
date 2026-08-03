import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getServerEnv } from "@/lib/env";

const OBJECT_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function storageRoot(): string {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), getServerEnv().MEDIA_STORAGE_DIR);
}

function resolveObjectPath(objectKey: string): string {
  if (!OBJECT_KEY_PATTERN.test(objectKey)) {
    throw new Error("Refusing to resolve a malformed storage object key.");
  }
  return path.join(storageRoot(), objectKey);
}

export async function writeStoredObject(objectKey: string, data: Buffer): Promise<void> {
  const filePath = resolveObjectPath(objectKey);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, data);
}

export async function readStoredObject(objectKey: string): Promise<Buffer> {
  return readFile(resolveObjectPath(objectKey));
}

export async function deleteStoredObject(objectKey: string): Promise<void> {
  await rm(resolveObjectPath(objectKey), { force: true });
}
