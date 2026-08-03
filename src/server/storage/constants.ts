export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const VIDEO_MIME_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;

export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 200 * 1024 * 1024;

export function mediaTypeForMime(mimeType: string): "image" | "video" | null {
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) return "image";
  if ((VIDEO_MIME_TYPES as readonly string[]).includes(mimeType)) return "video";
  return null;
}

export function maxBytesForMediaType(mediaType: "image" | "video"): number {
  return mediaType === "image" ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES;
}
