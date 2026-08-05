import { describe, expect, it } from "vitest";
import { matchesDeclaredSignature } from "@/server/storage/file-signature";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const GIF_BYTES = Buffer.from("GIF89a\0\0\0\0", "ascii");
const WEBP_BYTES = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP", "ascii"),
]);
const MP4_BYTES = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom", "ascii")]);
const WEBM_BYTES = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
const GARBAGE = Buffer.from("this is not a media file at all", "ascii");

describe("matchesDeclaredSignature", () => {
  it("accepts bytes whose signature matches the declared image type", () => {
    expect(matchesDeclaredSignature("image/png", PNG_BYTES)).toBe(true);
    expect(matchesDeclaredSignature("image/jpeg", JPEG_BYTES)).toBe(true);
    expect(matchesDeclaredSignature("image/gif", GIF_BYTES)).toBe(true);
    expect(matchesDeclaredSignature("image/webp", WEBP_BYTES)).toBe(true);
  });

  it("accepts bytes whose signature matches the declared video type", () => {
    expect(matchesDeclaredSignature("video/mp4", MP4_BYTES)).toBe(true);
    expect(matchesDeclaredSignature("video/quicktime", MP4_BYTES)).toBe(true);
    expect(matchesDeclaredSignature("video/webm", WEBM_BYTES)).toBe(true);
  });

  it("rejects a declared type whose bytes don't match, even when both are allow-listed", () => {
    expect(matchesDeclaredSignature("image/jpeg", PNG_BYTES)).toBe(false);
    expect(matchesDeclaredSignature("image/png", JPEG_BYTES)).toBe(false);
    expect(matchesDeclaredSignature("video/mp4", WEBM_BYTES)).toBe(false);
  });

  it("rejects arbitrary bytes declared as any known media type", () => {
    for (const mimeType of ["image/png", "image/jpeg", "image/gif", "image/webp", "video/mp4"]) {
      expect(matchesDeclaredSignature(mimeType, GARBAGE)).toBe(false);
    }
  });

  it("treats an unrecognized MIME type as unverifiable rather than rejecting here", () => {
    expect(matchesDeclaredSignature("application/x-msdownload", GARBAGE)).toBe(true);
  });

  it("rejects buffers too short to contain the expected signature", () => {
    expect(matchesDeclaredSignature("image/png", Buffer.from([0x89, 0x50]))).toBe(false);
    expect(matchesDeclaredSignature("video/mp4", Buffer.alloc(0))).toBe(false);
  });
});
