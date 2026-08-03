import { getServerEnv } from "@/lib/env";
import * as localDriver from "@/server/storage/local-driver";
import * as vercelBlobDriver from "@/server/storage/vercel-blob-driver";

export { createObjectKey } from "@/server/storage/object-key";

interface StorageDriver {
  writeStoredObject(objectKey: string, data: Buffer): Promise<void>;
  readStoredObject(objectKey: string): Promise<Buffer>;
  deleteStoredObject(objectKey: string): Promise<void>;
}

function activeDriver(): StorageDriver {
  return getServerEnv().STORAGE_DRIVER === "vercel-blob" ? vercelBlobDriver : localDriver;
}

export function writeStoredObject(objectKey: string, data: Buffer): Promise<void> {
  return activeDriver().writeStoredObject(objectKey, data);
}

export function readStoredObject(objectKey: string): Promise<Buffer> {
  return activeDriver().readStoredObject(objectKey);
}

export function deleteStoredObject(objectKey: string): Promise<void> {
  return activeDriver().deleteStoredObject(objectKey);
}
