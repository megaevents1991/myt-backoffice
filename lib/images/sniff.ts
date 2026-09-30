/** What the bytes actually are. The browser-declared mime is a claim, not a
 *  fact: an HTML page named screenshot.png arrives as image/png. SVG is
 *  rejected on purpose - it is a script container, not a screenshot. */
export type SniffedImage = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export function sniffImageMime(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length < 12) return null;
  const at = (i: number) => bytes[i];
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 &&
      at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) return "image/png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return "image/gif";
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
      at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return "image/webp";
  return null;
}

/** What a task attachment may be: one of the images above, or a PDF ("%PDF-"). Office
 *  files are zip containers - their bytes cannot be told from any other zip, so they stay out. */
export type SniffedAttachment = SniffedImage | "application/pdf";

export function sniffAttachmentMime(bytes: Uint8Array): SniffedAttachment | null {
  const image = sniffImageMime(bytes);
  if (image) return image;
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
      bytes[3] === 0x46 && bytes[4] === 0x2d) return "application/pdf";
  return null;
}
