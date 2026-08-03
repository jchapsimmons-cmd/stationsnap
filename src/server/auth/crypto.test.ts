import { describe, expect, it } from "vitest";
import { createOpaqueToken, hashSecret, hashToken, verifySecret } from "@/server/auth/crypto";

describe("authentication cryptography", () => {
  it("hashes secrets with a unique salt and verifies without storing plaintext", async () => {
    const first = await hashSecret("correct horse battery staple");
    const second = await hashSecret("correct horse battery staple");
    expect(first).not.toBe(second);
    expect(first).not.toContain("correct horse");
    await expect(verifySecret("correct horse battery staple", first)).resolves.toBe(true);
    await expect(verifySecret("wrong secret", first)).resolves.toBe(false);
  });

  it("rejects malformed hashes safely", async () => {
    await expect(verifySecret("secret", "not-a-valid-hash")).resolves.toBe(false);
  });

  it("creates non-guessable tokens and stores only their digest", () => {
    const token = createOpaqueToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(hashToken(token)).not.toBe(token);
    expect(hashToken(token)).toBe(hashToken(token));
  });
});
