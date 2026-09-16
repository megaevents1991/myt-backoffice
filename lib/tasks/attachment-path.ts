/** Pure path validation for task attachments (no dependencies). */

/**
 * Validates that an attachment path belongs to the given task:
 * - Must start with taskId/ (no traversal segments)
 * - Must contain exactly one slash (between taskId and filename)
 * - Filename must be UUID-like (alphanumeric + hyphens) + extension
 * Example: "task-123/a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6.png"
 */
export function isValidTaskAttachmentPath(taskId: string, path: unknown): boolean {
  if (typeof path !== "string") return false;

  // Escape special regex characters in taskId
  const escaped = taskId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Pattern: ^<taskId>/<uuid>.<ext>$
  // UUID-like: alphanumeric + hyphens, no forward slash, no parent dir reference
  const pattern = new RegExp(`^${escaped}/[A-Za-z0-9_-]+\\.[A-Za-z0-9]+$`);
  return pattern.test(path);
}
