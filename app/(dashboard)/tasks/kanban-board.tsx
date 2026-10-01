"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { ChevronDown, ChevronRight, MessageSquare } from "lucide-react";

import { cn } from "@/lib/utils";
import { useSessionState } from "@/hooks/use-view-state";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRIORITY_LABEL } from "@/components/task-editor";
import { canChangeStatus } from "@/lib/tasks/review";
import {
  groupTasks,
  initialsOf,
  PRIORITY_STYLE,
  STATUS_LABEL,
  type GroupBy,
} from "@/lib/tasks/kanban";
import { TASK_STATUSES, type TaskStatus, type TaskWithNames } from "@/types/task.types";

const DRAG_MIME = "text/task-id";

const DEFAULT_COLLAPSED: TaskStatus[] = ["cancelled"];
const isStatusList = (value: unknown): value is TaskStatus[] =>
  Array.isArray(value) &&
  value.every((s) => (TASK_STATUSES as readonly unknown[]).includes(s));

/** The board never shrinks below this, however short the window. */
const MIN_BOARD_HEIGHT = 320;
/** The dashboard's own bottom padding (md:p-6) - the board ends where the page does. */
const BOARD_BOTTOM_GAP = 24;

/** "2026-10-05" -> "05.10" on a card (the full date is in the tooltip). */
const shortDate = (iso: string) =>
  /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : iso;

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

  // cancelled starts folded - it is rarely where anyone is working. Any column
  // folds (a long Done list is the usual one), and the folded set is remembered
  // for the browser tab like the rest of this screen (hooks/use-view-state.ts).
  const [collapsedList, setCollapsedList] = useSessionState<TaskStatus[]>(
    "kanban:collapsed",
    DEFAULT_COLLAPSED,
    isStatusList,
  );
  const collapsed = new Set(collapsedList);
  const toggleCollapsed = (status: TaskStatus) =>
    setCollapsedList((current) =>
      current.includes(status) ? current.filter((s) => s !== status) : [...current, status],
    );

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

  // From md up the board takes exactly what is left of the screen and each
  // column scrolls inside itself - on a 15" laptop the page used to run far
  // below the fold, with the column heads (the drop targets) out of sight.
  // Measured rather than a fixed offset: what sits above the board (header,
  // board pills, tabs, filters) wraps differently at every width.
  const boardRef = useRef<HTMLDivElement>(null);
  const [boardHeight, setBoardHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!canDrag) {
      setBoardHeight(null);
      return;
    }
    const fit = () => {
      const board = boardRef.current;
      if (!board) return;
      const top = board.getBoundingClientRect().top + window.scrollY;
      setBoardHeight(Math.max(MIN_BOARD_HEIGHT, window.innerHeight - top - BOARD_BOTTOM_GAP));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [canDrag]);

  // One drop rule for an open column and a folded one.
  const dropHandlers = (status: TaskStatus) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      // Only claim this as a valid dropzone for one of OUR cards - anything
      // else (a file from the OS, text from another app) must fall through
      // to the browser's own handling instead of being silently "accepted".
      if (canDrag && event.dataTransfer.types.includes(DRAG_MIME)) {
        event.preventDefault();
      }
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      // Always prevent the browser's default drop action first (e.g.
      // navigating to / opening a dropped file) - reading the id only
      // decides whether WE act on it, it must not gate this.
      event.preventDefault();
      if (!canDrag) return;
      const id = event.dataTransfer.getData(DRAG_MIME);
      if (id) void move(id, status);
    },
  });

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

  // Same rule as the table's status select: admins, the owner, and the reviewer of a task
  // that waits for them (lib/tasks/review.ts).
  const canMove = (task: TaskWithNames) => canChangeStatus(role, task, userId);

  return (
    <div
      ref={boardRef}
      // The height is set from md up only (boardHeight is null below it):
      // phones keep the sideways strip of full-width columns.
      style={boardHeight ? { height: boardHeight } : undefined}
      className="flex gap-2 overflow-x-auto pb-1"
    >
      {TASK_STATUSES.map((status) => {
        const columnTasks = localTasks.filter((task) => task.status === status);
        const isCollapsed = collapsed.has(status);

        if (isCollapsed) {
          return (
            <button
              key={status}
              type="button"
              onClick={() => toggleCollapsed(status)}
              // A folded column still takes a dropped card.
              {...dropHandlers(status)}
              aria-label={`Expand ${STATUS_LABEL[status]} (${columnTasks.length})`}
              className="flex h-fit shrink-0 flex-col items-center gap-1.5 rounded-lg border bg-muted/40 px-1.5 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground md:h-auto"
            >
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              <span className="[writing-mode:vertical-rl]">
                {STATUS_LABEL[status]} ({columnTasks.length})
              </span>
            </button>
          );
        }

        return (
          <section
            key={status}
            {...dropHandlers(status)}
            // Phones: fixed-width columns in a sideways strip. From md up the
            // open columns share the row, down to a width a card still reads at.
            className="flex min-h-0 w-72 shrink-0 flex-col rounded-lg border bg-muted/20 md:w-auto md:min-w-[10.5rem] md:flex-1"
          >
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
              <h3 className="truncate text-[13px] font-semibold">
                {STATUS_LABEL[status]}{" "}
                <span className="font-normal text-muted-foreground">
                  ({columnTasks.length})
                </span>
              </h3>
              <button
                type="button"
                onClick={() => toggleCollapsed(status)}
                className="-me-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={`Collapse ${STATUS_LABEL[status]}`}
                title="Collapse column"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="scrollbar-rail min-h-0 flex-1 space-y-2.5 overflow-y-auto px-1.5 pb-1.5">
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
                        canDrag={canDrag && canMove(task)}
                        canPickStatus={!canDrag && canMove(task)}
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
        "rounded-md border bg-card p-2 shadow-sm",
        canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
      )}
    >
      <p className="line-clamp-2 text-[13px] font-medium leading-snug">{task.title}</p>

      {task.board === "marketing" && (
        <Progress value={task.progress ?? 0} className="mt-1.5 h-1" />
      )}

      {/* One line under the title: priority, owner, then due date and comments
          at the far end - two rows of it made every card a third taller. */}
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span
          className={cn(
            "inline-flex shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold",
            PRIORITY_STYLE[task.priority],
          )}
        >
          {PRIORITY_LABEL[task.priority]}
        </span>
        <span
          title={task.assignee_name ?? "Unassigned"}
          className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-secondary text-[9px] font-semibold text-secondary-foreground"
        >
          {task.assignee_name ? initialsOf(task.assignee_name) : "?"}
        </span>
        {task.due_date && (
          <span className="ms-auto shrink-0 tabular-nums" title={`Due ${task.due_date}`}>
            {shortDate(task.due_date)}
          </span>
        )}
        {task.comment_count > 0 && (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-0.5",
              !task.due_date && "ms-auto",
              task.unread_count > 0 && "font-semibold text-primary",
            )}
            title={task.unread_count > 0 ? `${task.unread_count} תגובות חדשות שלא קראת` : undefined}
          >
            <MessageSquare className="h-3 w-3" />
            {task.comment_count}
            {task.unread_count > 0 && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />}
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
