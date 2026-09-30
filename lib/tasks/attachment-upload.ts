// lib/tasks/attachment-upload.ts
// Browser side of a task attachment: shrink an image, send it to the private bucket.
// Shared by the thread's composer and the New-task dialog (which uploads once the task exists).
import { uploadTaskAttachment } from "@/lib/actions/task-comment-actions";
import type { TaskAttachment } from "@/types/task-comment.types";

/** What the file pickers offer - the server sniffs the real bytes again (lib/images/sniff.ts). */
export const ATTACHMENT_ACCEPT = "image/*,application/pdf";
export const MAX_ATTACHMENTS_PER_SEND = 5;
/** Mirrors ATTACHMENT_MAX_BYTES in task-comment-actions.ts (a "use server" file exports only
 *  actions). Checked here for a PDF, which is sent as it is - an image is shrunk first. */
export const ATTACHMENT_MAX_BYTES = 2.5 * 1024 * 1024;
const MAX_SHRUNK_WIDTH = 2000;

export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

/** A screenshot or a PDF - anything else is skipped before it is ever uploaded. */
export function isAttachableFile(file: File): boolean {
  return isImageMime(file.type) || file.type === "application/pdf";
}

/** Draws the file to a canvas and re-encodes it - returns the original file
 *  untouched when it is already narrower than maxWidth. */
async function shrinkToMaxWidth(
  file: File,
  maxWidth: number,
): Promise<{ file: File; width: number; height: number }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("image decode failed"));
    el.src = dataUrl;
  });

  if (image.width <= maxWidth) {
    return { file, width: image.width, height: image.height };
  }

  const scale = maxWidth / image.width;
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { file, width: image.width, height: image.height };
  ctx.drawImage(image, 0, 0, width, height);

  const mime = file.type || "image/png";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime));
  if (!blob) return { file, width: image.width, height: image.height };
  return { file: new File([blob], file.name, { type: mime }), width, height };
}

/** One file into the task's folder. An image is shrunk first; a PDF goes up as it is.
 *  `sent` is the file that was actually uploaded (the shrunk one) - for a local preview.
 *  Throws only when the shrink or the network does; a refusal comes back as `ok: false`. */
export async function uploadTaskFile(
  taskId: string,
  file: File,
): Promise<{ ok: true; attachment: TaskAttachment; sent: File } | { ok: false; error: string }> {
  const form = new FormData();
  let sent = file;
  if (isImageMime(file.type)) {
    const shrunk = await shrinkToMaxWidth(file, MAX_SHRUNK_WIDTH);
    sent = shrunk.file;
    form.set("width", String(shrunk.width));
    form.set("height", String(shrunk.height));
  }
  form.set("file", sent);
  const result = await uploadTaskAttachment(taskId, form);
  return result.ok ? { ok: true, attachment: result.attachment, sent } : result;
}
