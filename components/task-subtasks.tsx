"use client";

import { useState } from "react";
import { ListTree, Loader2, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createTask, setTaskStatus } from "@/lib/actions/task-actions";
import { canChangeStatus } from "@/lib/tasks/review";
import { STATUS_LABEL } from "@/lib/tasks/kanban";
import type { TaskStatus, TaskWithNames } from "@/types/task.types";

export type StaffOption = { id: string; name: string };

/** Sub-tasks that count toward "x of y done" - a cancelled part is no longer part of the job. */
export function subtaskProgress(subtasks: TaskWithNames[]): { done: number; total: number } {
  const live = subtasks.filter((task) => task.status !== "cancelled");
  return { done: live.filter((task) => task.status === "done").length, total: live.length };
}

/**
 * One general task split between several people (Alon, 28.09: "טאסק כללי וחלוקה של משימות
 * לכמה אנשים בפנים כי כל אחד יש תחום אחריות אחר"). Each part is an ordinary task with its own
 * assignee, status, thread and mails; this panel lists them under the general task and adds
 * new ones. Only an admin, or whoever the general task belongs to, may split it (createTask
 * checks it again); a non-admin's new part is always their own.
 */
export function TaskSubtasks({
  parent,
  subtasks,
  staff,
  isManager,
  userId,
  role,
  onChanged,
  onOpenTask,
}: {
  parent: TaskWithNames;
  subtasks: TaskWithNames[];
  /** Assignable people - null for a non-admin (they can only take a part themselves). */
  staff: StaffOption[] | null;
  isManager: boolean;
  userId: string | null;
  role: string;
  onChanged: () => void;
  onOpenTask?: (task: TaskWithNames) => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  // An admin's new part starts unassigned; anyone else's starts as their own (still changeable -
  // editors assign too since 01.10).
  const [assignee, setAssignee] = useState<string>(isManager ? "unassigned" : (userId ?? "unassigned"));
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const canSplit = isManager || (!!userId && (parent.assignee_id === userId || parent.created_by === userId));
  const { done, total } = subtaskProgress(subtasks);
  if (!canSplit && subtasks.length === 0) return null;

  const add = async () => {
    const name = title.trim();
    if (!name) return;
    setAdding(true);
    try {
      const result = await createTask({
        title: name,
        priority: parent.priority,
        due_date: parent.due_date,
        assignee_id: assignee === "unassigned" ? null : assignee,
        parent_id: parent.id,
      });
      if (!result.ok) {
        toast({ variant: "destructive", title: "לא נוספה", description: result.error });
        return;
      }
      toast({
        title: "תת-משימה נוספה",
        description:
          result.mail === "sent"
            ? "נשלח מייל לאחראי."
            : result.mail === "failed"
              ? "המייל לאחראי נכשל - תעדכן אותו ישירות."
              : undefined,
      });
      setTitle("");
      onChanged();
    } finally {
      setAdding(false);
    }
  };

  const changeStatus = async (task: TaskWithNames, status: TaskStatus) => {
    setBusyId(task.id);
    try {
      const result = await setTaskStatus(task.id, status);
      if (!result.ok) {
        toast({ variant: "destructive", title: "Update failed", description: result.error });
        return;
      }
      onChanged();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="rounded-md border bg-muted/30 p-3" dir="rtl">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <ListTree className="h-4 w-4 text-muted-foreground" />
          תתי-משימות
        </span>
        {total > 0 && (
          <span className="text-xs text-muted-foreground tabular">
            {done}/{total} הושלמו
          </span>
        )}
      </div>
      {total > 0 && (
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${Math.round((done / total) * 100)}%` }} />
        </div>
      )}

      {subtasks.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {subtasks.map((task) => {
            const canStatus = canChangeStatus(role, task, userId);
            return (
              <li key={task.id} className="flex items-center gap-2 text-sm">
                <Select
                  value={task.status}
                  onValueChange={(value) => changeStatus(task, value as TaskStatus)}
                  disabled={!canStatus || busyId === task.id}
                >
                  <SelectTrigger className="h-7 w-[110px] shrink-0 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((status) => (
                      <SelectItem key={status} value={status}>
                        {STATUS_LABEL[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  onClick={() => onOpenTask?.(task)}
                  className={cn(
                    "min-w-0 flex-1 truncate text-start hover:underline",
                    (task.status === "done" || task.status === "cancelled") && "text-muted-foreground line-through",
                  )}
                  title={task.title}
                >
                  {task.title}
                </button>
                <span className={cn("shrink-0 text-xs", task.assignee_name ? "text-foreground" : "text-muted-foreground")}>
                  {task.assignee_name ?? "לא משויך"}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {canSplit && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
            placeholder="חלק חדש במשימה…"
            className="h-8 min-w-[180px] flex-1 text-sm"
            disabled={adding}
          />
          {staff && (
            <Select value={assignee} onValueChange={setAssignee} disabled={adding}>
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">לא משויך</SelectItem>
                {staff.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" className="h-8" onClick={add} disabled={adding || !title.trim()}>
            {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            <span className="ms-1">הוסף</span>
          </Button>
        </div>
      )}
    </div>
  );
}
