import { del, head, put } from "@vercel/blob";
import { getServerEnv } from "@/lib/env";

function token(): string {
  const value = getServerEnv().BLOB_READ_WRITE_TOKEN;
  if (!value) throw new Error("BLOB_READ_WRITE_TOKEN is not configured.");
  return value;
}

export async function writeStoredObject(objectKey: string, data: Buffer): Promise<void> {
  await put(objectKey, data, {
    access: "public",
    addRandomSuffix: false,
    token: token(),
  });
}

export async function readStoredObject(objectKey: string): Promise<Buffer> {
  const info = await head(objectKey, { token: token() });
  const response = await fetch(info.url);
  if (!response.ok) {
    throw new Error(`Failed to read stored object "${objectKey}": ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteStoredObject(objectKey: string): Promise<void> {
  const info = await head(objectKey, { token: token() }).catch(() => null);
  if (!info) return;
  await del(info.url, { token: token() });
}
