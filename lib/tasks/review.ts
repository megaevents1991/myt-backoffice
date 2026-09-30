// lib/tasks/review.ts
// The "review" status (Dor, 30.09): whoever owns a task finishes their side and hands it
// back - "אני מסיים את הצד שלי, מעביר ל-review, והוא מקבל את המשימה חזרה אליו". The task
// keeps its assignee (the record of who did the work); what changes is whose move it is.
// Pure - no DB, no session (scripts/task-thread-selftest.ts).
import { ADMIN_ROLES } from "@/types/auth.types";
import type { TaskStatus } from "@/types/task.types";

interface ReviewTask {
  status: TaskStatus;
  assignee_id: string | null;
  created_by: string | null;
  /** Who handed the task to its current owner (lib/tasks/owner-filter.ts). */
  assigned_by: string | null;
  /** Explicit reviewers picked on the form; null / empty = the default below. */
  reviewer_ids: string[] | null;
}

type ReviewerFields = Pick<ReviewTask, "created_by" | "assigned_by" | "reviewer_ids">;

/** Who a task goes back to. Picked on the form when it was ("Alon opened it, but Tom has to
 *  look at it - or both"); otherwise the person who opened it, and for a task nobody human
 *  opened (a recurring rule's) whoever assigned it - or nobody would ever hear about it. */
export function reviewersOf(task: ReviewerFields): string[] {
  const picked = (task.reviewer_ids ?? []).filter((id): id is string => typeof id === "string" && id.length > 0);
  if (picked.length > 0) return [...new Set(picked)];
  const fallback = task.created_by ?? task.assigned_by ?? null;
  return fallback ? [fallback] : [];
}

/** The task sits in review and it is THIS person's move. */
export function awaitsReviewBy(
  task: ReviewerFields & Pick<ReviewTask, "status">,
  userId: string | null,
): boolean {
  return !!userId && task.status === "review" && reviewersOf(task).includes(userId);
}

/** Who may change a task's status: an admin, its owner, and - while it waits for their
 *  review - a reviewer, who has to be able to approve it (done) or send it back. */
export function canChangeStatus(role: string, task: ReviewTask, userId: string | null): boolean {
  if ((ADMIN_ROLES as readonly string[]).includes(role)) return true;
  if (!userId) return false;
  return task.assignee_id === userId || awaitsReviewBy(task, userId);
}

/** What a status change means for the review hand-off - each one is a mail:
 *  sent = handed to the reviewer · approved = the reviewer closed it · returned = back to work.
 *  A review that is cancelled, or a change that never touches review, is none of them. */
export type ReviewMove = "sent" | "approved" | "returned";

export function reviewMove(previous: TaskStatus | null, next: TaskStatus): ReviewMove | null {
  if (next === "review") return previous === "review" ? null : "sent";
  if (previous !== "review") return null;
  if (next === "done") return "approved";
  if (next === "cancelled") return null;
  return "returned";
}
