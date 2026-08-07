/**
 * Content sniffing for uploaded images.
 *
 * The `Content-Type` on a multipart part is supplied by the client and is
 * trivially forged, so it must never be the only check: a `.png`-labelled
 * payload can be anything at all. These signatures read the actual leading
 * bytes, which is the only claim the uploader cannot simply assert.
 */

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const;

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

const EXTENSION_BY_MIME: Record<AllowedImageMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

const startsWith = (buffer: Buffer, bytes: number[]): boolean =>
  bytes.every((byte, index) => buffer[index] === byte);

/**
 * Returns the MIME type implied by the file's magic bytes, or `null` when the
 * content is not a supported image.
 */
export function sniffImageMimeType(buffer: Buffer): AllowedImageMimeType | null {
  if (buffer.length < 12) return null;

  // FF D8 FF — JPEG (SOI + first marker).
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';

  // 89 50 4E 47 0D 0A 1A 0A — PNG.
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';

  // RIFF....WEBP — bytes 8-11 carry the form type.
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }

  // ....ftypavif — ISO-BMFF brand at byte 4.
  if (buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }

  return null;
}

export function extensionFor(mimeType: AllowedImageMimeType): string {
  return EXTENSION_BY_MIME[mimeType];
}
