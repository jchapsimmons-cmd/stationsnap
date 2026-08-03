import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(nodeScrypt) as (
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const parameters = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const keyLength = 32;

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(secret, salt, keyLength, parameters);
  return `scrypt$v=1$n=${parameters.N}$r=${parameters.r}$p=${parameters.p}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifySecret(secret: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 7 || parts[0] !== "scrypt" || parts[1] !== "v=1") return false;

  const n = Number(parts[2]?.replace("n=", ""));
  const r = Number(parts[3]?.replace("r=", ""));
  const p = Number(parts[4]?.replace("p=", ""));
  const saltValue = parts[5];
  const hashValue = parts[6];
  if (
    !saltValue ||
    !hashValue ||
    !Number.isSafeInteger(n) ||
    !Number.isSafeInteger(r) ||
    !Number.isSafeInteger(p)
  )
    return false;

  try {
    const expected = Buffer.from(hashValue, "base64url");
    const actual = await scrypt(secret, Buffer.from(saltValue, "base64url"), expected.length, {
      N: n,
      r,
      p,
      maxmem: parameters.maxmem,
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function createOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase("en-US");
}
