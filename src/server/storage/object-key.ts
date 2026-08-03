import { randomUUID } from "node:crypto";

export function createObjectKey(organizationId: string): string {
  return `${organizationId}/${randomUUID()}`;
}
