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
  "reviewer_ids",
] as const;
export type EditableTaskField = (typeof TASK_FIELDS)[number];

/** What an editor may change on a task assigned to them: its progress, and who has it - they
 *  can hand it on (Dor, 01.10: Liz opened a task and could not give it to anyone). */
const EDITOR_OWN_TASK_FIELDS: readonly EditableTaskField[] = ["status", "progress", "assignee_id"];

/** What an editor may change on a task they OPENED that someone else holds: who holds it. */
const EDITOR_OPENED_TASK_FIELDS: readonly EditableTaskField[] = ["assignee_id"];

function isManagerRole(role: string): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}

/**
 * The whole board is visible to every staff member (Dor, 16.09) - what
 * narrows is editing. Admins (superadmin/admin) edit everything, anywhere.
 * An editor changes status/progress only on a task assigned to them, and may
 * re-assign a task assigned to them or one they opened (01.10); on anyone
 * else's task they have no edit rights at all (comments are a separate,
 * always-open door - see TaskThread). A NEW task is not governed here: any
 * staff member fills in every field of a task they create, assignee included.
 */
export function editableFields(
  role: string,
  isOwnTask: boolean,
  isOpenedByMe = false,
): Set<EditableTaskField> {
  if (isManagerRole(role)) return new Set(TASK_FIELDS);
  if (isOwnTask) return new Set(EDITOR_OWN_TASK_FIELDS);
  if (isOpenedByMe) return new Set(EDITOR_OPENED_TASK_FIELDS);
  return new Set();
}

export function canEditTaskField(
  role: string,
  isOwnTask: boolean,
  field: EditableTaskField,
  isOpenedByMe = false,
): boolean {
  return editableFields(role, isOwnTask, isOpenedByMe).has(field);
}
