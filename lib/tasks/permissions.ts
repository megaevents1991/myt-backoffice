import { ADMIN_ROLES } from "@/types/auth.types";

/**
 * Every field a task's create/update forms can carry. Not every field is
 * reachable through every action - `status` only ever changes via
 * `setTaskStatus`, never `updateTask` - but this list is the one place that
 * decides who may touch what, so the server and the UI read the same answer.
 */
export const TASK_FIELDS = [
  "title",
  "description",
  "priority",
  "assignee_id",
  "due_date",
  "board",
  "phase",
  "channel",
  "progress",
  "status",
] as const;
export type EditableTaskField = (typeof TASK_FIELDS)[number];

/** The only two fields an editor may ever change, and only on their own task. */
const EDITOR_OWN_TASK_FIELDS: readonly EditableTaskField[] = ["status", "progress"];

function isManagerRole(role: string): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}

/**
 * The whole board is visible to every staff member (Dor, 16.09) - what
 * narrows is editing. Admins (superadmin/admin) edit everything, anywhere.
 * An editor touches only status/progress, and only on a task assigned to
 * them; on anyone else's task they have no edit rights at all (comments are
 * a separate, always-open door - see TaskThread).
 */
export function editableFields(role: string, isOwnTask: boolean): Set<EditableTaskField> {
  if (isManagerRole(role)) return new Set(TASK_FIELDS);
  if (isOwnTask) return new Set(EDITOR_OWN_TASK_FIELDS);
  return new Set();
}

export function canEditTaskField(
  role: string,
  isOwnTask: boolean,
  field: EditableTaskField,
): boolean {
  return editableFields(role, isOwnTask).has(field);
}
