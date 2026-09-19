// lib/tasks/thread-watch.ts
// Who a task's conversation belongs to, and what in it one person has not read yet.
// Pure - no DB, no session (scripts/task-thread-selftest.ts). One rule serves both the
// unread marker on the board and the "new comment" mail, so the two can never disagree
// about who is part of a conversation.

/** The slice of a task_comments row these rules need (kind = comment, not deleted). */
export interface ThreadCommentRow {
  task_id: string;
  author_id: string | null;
  created_at: string;
  mentions: string[];
}

export interface ThreadTask {
  id: string;
  created_by: string | null;
  assignee_id: string | null;
}

/** Everyone the conversation on one task belongs to: who opened it, who owns it, who
 *  wrote in it and who was @mentioned in it. `comments` must be that task's rows only. */
export function threadParticipants(task: ThreadTask, comments: ThreadCommentRow[]): Set<string> {
  const ids = new Set<string>();
  if (task.created_by) ids.add(task.created_by);
  if (task.assignee_id) ids.add(task.assignee_id);
  for (const comment of comments) {
    if (comment.author_id) ids.add(comment.author_id);
    for (const id of comment.mentions) ids.add(id);
  }
  return ids;
}

/** Who the "new comment" mail goes to: every participant so far - which is what makes a
 *  REPLY reach the person it answers - except the author and the people this comment
 *  @mentions (the mention mail already covers them: one mail per comment per person). */
export function commentMailTargets(input: {
  task: ThreadTask;
  /** The task's comments BEFORE the new one. */
  earlier: ThreadCommentRow[];
  authorId: string | null;
  mentionedIds: string[];
}): string[] {
  const out = threadParticipants(input.task, input.earlier);
  if (input.authorId) out.delete(input.authorId);
  for (const id of input.mentionedIds) out.delete(id);
  return [...out];
}

/** Unread comments per task for ONE person: comments written by someone else after that
 *  person last opened the thread (never opened = all of them). Only on tasks whose
 *  conversation the person is part of - the whole board is visible to everyone, and a dot
 *  on every task anyone ever commented on would mark nothing. Tasks with 0 are left out. */
export function unreadCounts(input: {
  userId: string;
  tasks: ThreadTask[];
  comments: ThreadCommentRow[];
  /** task id -> when this person last opened its thread. */
  lastReadAt: Map<string, string>;
}): Map<string, number> {
  const byTask = new Map<string, ThreadCommentRow[]>();
  for (const comment of input.comments) {
    const list = byTask.get(comment.task_id);
    if (list) list.push(comment);
    else byTask.set(comment.task_id, [comment]);
  }

  const counts = new Map<string, number>();
  for (const task of input.tasks) {
    const comments = byTask.get(task.id);
    if (!comments?.length) continue;
    if (!threadParticipants(task, comments).has(input.userId)) continue;

    const readAt = input.lastReadAt.get(task.id);
    const readMs = readAt ? Date.parse(readAt) : Number.NEGATIVE_INFINITY;
    const unread = comments.filter(
      (comment) => comment.author_id !== input.userId && Date.parse(comment.created_at) > readMs,
    ).length;
    if (unread > 0) counts.set(task.id, unread);
  }
  return counts;
}
