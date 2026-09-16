"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, MessageSquare } from "lucide-react";

import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRIORITY_LABEL } from "@/components/task-editor";
import {
  canDragCard,
  groupTasks,
  initialsOf,
  PRIORITY_STYLE,
  STATUS_LABEL,
  type GroupBy,
} from "@/lib/tasks/kanban";
import { TASK_STATUSES, type TaskStatus, type TaskWithNames } from "@/types/task.types";

const DRAG_MIME = "text/task-id";

/**
 * Native HTML5 drag-and-drop kanban - no dnd library (spec: none allowed).
 * `onStatusChange` returns success/failure only; the board owns the
 * optimistic move and the rollback, the CALLER owns telling the user why it
 * failed (tasks-client.tsx already toasts setTaskStatus's error there, same
 * as the table's status <Select>).
 */
export function KanbanBoard({
  tasks,
  onStatusChange,
  groupBy,
  role,
  userId,
  onOpenTask,
}: {
  tasks: TaskWithNames[];
  onStatusChange: (id: string, status: TaskStatus) => Promise<boolean>;
  groupBy: GroupBy;
  role: string;
  userId: string | null;
  onOpenTask: (task: TaskWithNames) => void;
}) {
  const [localTasks, setLocalTasks] = useState(tasks);
  // Every parent reload() lands a fresh array here - that is also how a
  // failed move's rollback disappears once the next real list arrives.
  useEffect(() => {
    setLocalTasks(tasks);
  }, [tasks]);

  // cancelled starts folded - it is rarely where anyone is working.
  const [collapsed, setCollapsed] = useState<Set<TaskStatus>>(new Set(["cancelled"]));
  const toggleCollapsed = (status: TaskStatus) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });

  // HTML5 drag does not fire on touch - below md a card gets a status
  // <Select> instead of being draggable. Effect has cleanup per the brief.
  const [canDrag, setCanDrag] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const apply = () => setCanDrag(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  const move = async (id: string, status: TaskStatus) => {
    const moved = localTasks.find((task) => task.id === id);
    if (!moved || moved.status === status) return;
    const previousStatus = moved.status;
    setLocalTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, status } : task)),
    );
    const ok = await onStatusChange(id, status);
    // Roll back only the one card - restoring the whole snapshot would also
    // discard any fresher state (another card's move, a reload) that landed
    // while this request was in flight.
    if (!ok) {
      setLocalTasks((current) =>
        current.map((task) => (task.id === id ? { ...task, status: previousStatus } : task)),
      );
    }
  };

  const isOwnTask = (task: TaskWithNames) => !!userId && task.assignee_id === userId;

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {TASK_STATUSES.map((status) => {
        const columnTasks = localTasks.filter((task) => task.status === status);
        const isCollapsed = collapsed.has(status);

        if (isCollapsed) {
          return (
            <button
              key={status}
              type="button"
              onClick={() => toggleCollapsed(status)}
              className="flex h-fit shrink-0 items-center gap-1.5 rounded-lg border bg-muted/40 px-2 py-3 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="[writing-mode:vertical-rl]">
                {STATUS_LABEL[status]} ({columnTasks.length})
              </span>
            </button>
          );
        }

        return (
          <section
            key={status}
            onDragOver={(event) => {
              // Only claim this as a valid dropzone for one of OUR cards -
              // anything else (a file from the OS, text from another app)
              // must fall through to the browser's own handling instead of
              // being silently "accepted" here.
              if (canDrag && event.dataTransfer.types.includes(DRAG_MIME)) {
                event.preventDefault();
              }
            }}
            onDrop={(event) => {
              // Always prevent the browser's default drop action first (e.g.
              // navigating to / opening a dropped file) - reading the id only
              // decides whether WE act on it, it must not gate this.
              event.preventDefault();
              if (!canDrag) return;
              const id = event.dataTransfer.getData(DRAG_MIME);
              if (id) void move(id, status);
            }}
            className="flex w-72 shrink-0 flex-col rounded-lg border bg-muted/20"
          >
            <div className="flex items-center justify-between px-3 py-2">
              <h3 className="text-sm font-semibold">
                {STATUS_LABEL[status]}{" "}
                <span className="font-normal text-muted-foreground">
                  ({columnTasks.length})
                </span>
              </h3>
              {status === "cancelled" && (
                <button
                  type="button"
                  onClick={() => toggleCollapsed(status)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Collapse column"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex-1 space-y-3 px-2 pb-2">
              {groupTasks(columnTasks, groupBy).map((group) => (
                <div key={group.key} className="space-y-1.5">
                  {group.label && (
                    <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.label} ({group.tasks.length})
                    </p>
                  )}
                  <div className="space-y-1.5">
                    {group.tasks.map((task) => (
                      <KanbanCard
                        key={task.id}
                        task={task}
                        canDrag={canDrag && canDragCard(role, isOwnTask(task))}
                        canPickStatus={!canDrag && canDragCard(role, isOwnTask(task))}
                        onClick={() => onOpenTask(task)}
                        onStatusPick={(next) => void move(task.id, next)}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {columnTasks.length === 0 && (
                <p className="px-1 py-4 text-center text-xs text-muted-foreground">Empty</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function KanbanCard({
  task,
  canDrag,
  canPickStatus,
  onClick,
  onStatusPick,
}: {
  task: TaskWithNames;
  canDrag: boolean;
  canPickStatus: boolean;
  onClick: () => void;
  onStatusPick: (status: TaskStatus) => void;
}) {
  return (
    <article
      draggable={canDrag}
      onDragStart={(event) => event.dataTransfer.setData(DRAG_MIME, task.id)}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={task.title}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        // Space would otherwise scroll the column - this key press opens the
        // task instead, same as a click.
        event.preventDefault();
        onClick();
      }}
      className={cn(
        "rounded-lg border bg-card p-3 shadow-sm",
        canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
      )}
    >
      <p className="mb-2 line-clamp-2 text-sm font-medium">{task.title}</p>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
            PRIORITY_STYLE[task.priority],
          )}
        >
          {PRIORITY_LABEL[task.priority]}
        </span>
        <span
          title={task.assignee_name ?? "Unassigned"}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-secondary-foreground"
        >
          {task.assignee_name ? initialsOf(task.assignee_name) : "?"}
        </span>
      </div>

      {task.board === "marketing" && (
        <Progress value={task.progress ?? 0} className="mb-2 h-1.5" />
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{task.due_date ?? "—"}</span>
        {task.comment_count > 0 && (
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            {task.comment_count}
          </span>
        )}
      </div>

      {canPickStatus && (
        // Stops the click/keydown from reaching the card's own handler above -
        // this select only ever appears when the card isn't draggable (mobile
        // vs desktop are mutually exclusive), so there is no drag gesture to
        // protect here, just the card's own open-on-click/Enter/Space.
        <div
          className="mt-2"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Select value={task.status} onValueChange={(value) => onStatusPick(value as TaskStatus)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {STATUS_LABEL[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </article>
  );
}
