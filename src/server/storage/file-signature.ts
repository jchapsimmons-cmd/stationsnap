/**
 * Verifies an uploaded file's actual bytes match its declared MIME type. Every upload path
 * (SOP media, checklist evidence, training evidence, approval resubmission) trusts only the
 * client-supplied `File.type` before this check existed; a client can declare any allow-listed
 * MIME type on arbitrary bytes. Confirming a real signature at the start of the buffer closes
 * that gap for the common container/format families this app accepts, and is checked in
 * addition to (not instead of) the existing declared-type allowlist and size caps.
 */

type SignatureCheck = (buffer: Buffer) => boolean;

function startsWith(bytes: number[]): SignatureCheck {
  return (buffer) =>
    buffer.length >= bytes.length && bytes.every((byte, index) => buffer[index] === byte);
}

function isRiffWebp(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  const riff = buffer.subarray(0, 4).toString("ascii");
  const webp = buffer.subarray(8, 12).toString("ascii");
  return riff === "RIFF" && webp === "WEBP";
}

/** ISO base media file format: a 4-byte size followed by an ASCII box type at offset 4. */
function hasIsoBmffBoxType(buffer: Buffer, boxTypes: string[]): boolean {
  if (buffer.length < 12) return false;
  const boxType = buffer.subarray(4, 8).toString("ascii");
  return boxTypes.includes(boxType);
}

const SIGNATURE_CHECKS: Record<string, SignatureCheck> = {
  "image/jpeg": startsWith([0xff, 0xd8, 0xff]),
  "image/png": startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/webp": isRiffWebp,
  "image/gif": (buffer) => {
    const header = buffer.subarray(0, 6).toString("ascii");
    return header === "GIF87a" || header === "GIF89a";
  },
  "video/mp4": (buffer) => hasIsoBmffBoxType(buffer, ["ftyp"]),
  // Legacy QuickTime .mov files may use an `ftyp` box (modern) or start directly with a
  // `moov`/`mdat`/`wide`/`free`/`skip` box (older exports without a file-type box).
  "video/quicktime": (buffer) =>
    hasIsoBmffBoxType(buffer, ["ftyp", "moov", "mdat", "wide", "free", "skip"]),
  // EBML header, shared by WebM and Matroska.
  "video/webm": startsWith([0x1a, 0x45, 0xdf, 0xa3]),
};

/**
 * Returns false when the declared MIME type has a known signature check and the buffer's actual
 * bytes fail it. An unrecognized MIME type (not in `SIGNATURE_CHECKS`) is treated as unverifiable
 * rather than rejected here — the caller's own MIME allowlist is what rejects those.
 */
export function matchesDeclaredSignature(mimeType: string, buffer: Buffer): boolean {
  const check = SIGNATURE_CHECKS[mimeType];
  if (!check) return true;
  return check(buffer);
}
