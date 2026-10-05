"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import {
  AlarmClock,
  Check,
  CornerDownLeft,
  ExternalLink,
  Eye,
  ListTree,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Wrench,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UrlTabs } from "@/components/url-tabs";
import { useSessionState, useUrlState } from "@/hooks/use-view-state";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PRIORITY_LABEL,
  TaskEditor,
  type TaskEditorState,
  type TaskPrefill,
} from "@/components/task-editor";
import { TaskThread } from "@/components/task-thread";
import { TaskRemindButton } from "@/components/task-remind-button";
import { TaskSubtasks, type StaffOption } from "@/components/task-subtasks";
import { generalTasks, partsByTask, subtaskProgress } from "@/lib/tasks/subtasks";
import type { StaffMentionOption } from "@/types/task-comment.types";
import { listStaffForMentions } from "@/lib/actions/task-comment-actions";
import {
  bulkUpdateTasks,
  deleteTask,
  findTaskCompany,
  listTaskAssignees,
  listTasks,
  openTaskGapKeys,
  setTaskStatus,
} from "@/lib/actions/task-actions";
import { setActiveCompany } from "@/lib/actions/company-actions";
import {
  dismissCreativeGap,
  listAllCreativeGaps,
  listDismissedGaps,
  restoreCreativeGap,
  type DismissedGap,
} from "@/lib/actions/creative-gap-actions";
import { editableFields } from "@/lib/tasks/permissions";
import { matchesOwner, type OwnerFilter } from "@/lib/tasks/owner-filter";
import {
  TASK_VIEWS,
  awaitsReviewBy,
  canChangeStatus,
  inTaskView,
  isTaskView,
  reviewRank,
  taskViewOf,
  type TaskView,
} from "@/lib/tasks/review";
import { BOARD_META } from "@/lib/task-boards";
import { KanbanBoard } from "./kanban-board";
import { PricingGapsTab } from "./pricing-gaps-tab";
import { TaskMapView } from "./task-map-view";
import { RulesTab } from "./rules-tab";
import {
  filterByBoard,
  parseBoardParam,
  PRIORITY_STYLE,
  STATUS_LABEL,
  type GroupBy,
} from "@/lib/tasks/kanban";
import { ADMIN_ROLES } from "@/types/auth.types";
import {
  GAP_KINDS,
  GAP_META,
  gapKey,
  type GapItem,
  type GapKind,
} from "@/types/creative-gap.types";
import {
  OPEN_TASK_STATUSES,
  PRIORITY_ORDER,
  TASK_BOARDS,
  type TaskBoard,
  type TaskSource,
  type TaskStatus,
  type TaskWithNames,
} from "@/types/task.types";

/** Every tab `?tab=` may deep-link to. */
const TAB_IDS = ["tasks", "kanban", "roadmap", "marketing", "gaps", "pricing", "rules"] as const;
/** The tabs of the plain board (a company that sells no events - lib/services/task-company.ts):
 *  the list and the Kanban. Roadmap, Marketing, gaps, pricing and rules are Mega Events'. */
const PLAIN_TAB_IDS = ["tasks", "kanban"] as const;
/** The Tasks table's saved views - `?view=` (Open / In review / Done / All, lib/tasks/review.ts). */
const VIEW_IDS = TASK_VIEWS;

/** Small badge on sourced tasks - where the work came from. */
const SOURCE_BADGE: Partial<Record<TaskSource, string>> = {
  creative_gap: "creative",
  price_review: "price",
};

/** Still work to do - "paused" included (OPEN_TASK_STATUSES). */
function isOpen(task: TaskWithNames): boolean {
  return (OPEN_TASK_STATUSES as readonly string[]).includes(task.status);
}

/** A gap → the task it becomes. The deep link, not the page: whoever picks
 *  this task up lands on the control that fixes it. */
function gapPrefill(gap: GapItem): TaskPrefill {
  return {
    title: `${GAP_META[gap.kind].label}: ${gap.label}`,
    source: "creative_gap",
    source_ref: {
      kind: gap.kind,
      table: gap.table,
      row_id: gap.row_id,
      label: gap.label,
      url: gap.fixUrl,
    },
    origin: `From creative gap: ${gap.label}`,
  };
}

/**
 * `plainBoard` comes from the server page (the active company sells no events): one board, no
 * board lens, only the Tasks and Kanban tabs. It decides what is drawn - the actions enforce
 * the same rule on their own (requireTaskBoard).
 */
export function TasksClient({ plainBoard = false }: { plainBoard?: boolean }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  // ONE top-level useSearchParams for the whole page - ?tab=, ?task= and now
  // ?board= all read from this same instance (never a second hook call).
  const searchParams = useSearchParams();
  // /tasks?tab=<id> deep-links straight to that tab (TAB_IDS); anything else opens Tasks.
  const tabIds: readonly string[] = plainBoard ? PLAIN_TAB_IDS : TAB_IDS;
  const tabParam = searchParams.get("tab") ?? "";
  const initialTab = tabIds.includes(tabParam) ? tabParam : "tasks";
  const initialTaskId = searchParams.get("task");
  const boardLens = plainBoard ? "all" : parseBoardParam(searchParams.get("board"));
  const isManager = !!user && (ADMIN_ROLES as readonly string[]).includes(user.role);

  const [tasks, setTasks] = useState<TaskWithNames[]>([]);
  const [loading, setLoading] = useState(true);
  // Where you are survives a refresh (hooks/use-view-state.ts): the tab and the Open / Done /
  // All view in the URL, the owner filter and the kanban grouping for the browser tab.
  const [view, setView] = useUrlState<string>("view", "open", VIEW_IDS);
  const taskView: TaskView = isTaskView(view) ? view : "open";
  const [groupBy, setGroupBy] = useSessionState<GroupBy>("groupBy", "none");
  // Phases exist on the Mega Events dev board only - a stored "phase" grouping means nothing
  // on the plain board.
  const kanbanGroupBy: GroupBy = plainBoard && groupBy === "phase" ? "none" : groupBy;
  // The whole board is visible (16.09) - the owner filter says whose tasks are on screen:
  // mine (an editor's default), everyone's (an admin's default - they assign work), the ones
  // I handed to someone else, or - admins - one person's (30.09). Null = not chosen yet, so
  // the role's default applies (and is not pinned by a stored copy).
  const [ownerChoice, setOwner] = useSessionState<OwnerFilter | null>(
    "owner",
    null,
    (value): value is OwnerFilter | null => value === null || typeof value === "string",
  );
  const owner: OwnerFilter = ownerChoice ?? (isManager ? "all" : "mine");
  const [editor, setEditor] = useState<TaskEditorState>({ open: false, task: null });
  const handledTaskRef = useRef<string | null>(null);
  const activeTabRef = useRef<string>(initialTab);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setTasks(await listTasks());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Assignable people for the bulk bar and the sub-tasks panel: the people of the ACTIVE
  // company (lib/services/task-people.ts - Mega Events' active staff, or a company's members).
  // Admins read them newest first, the order their picker always had; since editors assign
  // too (01.10) they read the same people by name, like the @mention picker.
  // Loaded ONCE here and handed to the task dialog and to every thread (05.10): each of them
  // used to fetch its own copy on every open, queued ahead of the comments.
  const [people, setPeople] = useState<StaffMentionOption[] | null>(null);
  useEffect(() => {
    if (!user) return;
    (isManager ? listTaskAssignees() : listStaffForMentions())
      .then(setPeople)
      .catch((error) => console.error("tasks: staff list failed", error));
  }, [isManager, user]);
  const staff = useMemo<StaffOption[] | null>(
    () => people?.map((person) => ({ id: person.id, name: person.display_name || person.email })) ?? null,
    [people],
  );

  // Sub-tasks by general task, over the WHOLE board (a part assigned to someone else still
  // counts toward its parent's "x/y" when the "my tasks" switch hides it).
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task] as const)), [tasks]);
  const childrenOf = useMemo(() => partsByTask(tasks), [tasks]);

  useEffect(() => {
    if (loading || !tasks.length || !initialTaskId) return;
    if (handledTaskRef.current === initialTaskId) return;
    const found = tasks.find((t) => t.id === initialTaskId);
    if (found) {
      setEditor({ open: true, task: found });
    }
    handledTaskRef.current = initialTaskId;
  }, [loading, tasks, initialTaskId]);

  // A task link this board does not hold: the board is per company, and a mail sent before
  // links carried `company=` may be opened while working in another one. Ask - once - whether
  // one of MY other companies has the task, and offer to go there. A link that names its
  // company is switched by the app itself, so it is left alone here.
  const [elsewhere, setElsewhere] = useState<{ slug: string; name: string } | null>(null);
  const linkCompany = searchParams.get("company");
  const lookedUpTaskRef = useRef<string | null>(null);
  useEffect(() => {
    if (loading || !initialTaskId || linkCompany) return;
    if (lookedUpTaskRef.current === initialTaskId) return;
    lookedUpTaskRef.current = initialTaskId;
    if (tasks.some((t) => t.id === initialTaskId)) return;
    findTaskCompany(initialTaskId)
      .then(setElsewhere)
      .catch((error) => console.error("tasks: task company lookup failed", error));
  }, [loading, tasks, initialTaskId, linkCompany]);
  const goToTaskCompany = useCallback(async () => {
    if (!elsewhere || !initialTaskId) return;
    const result = await setActiveCompany(elsewhere.slug);
    if (!result.success) {
      toast({ variant: "destructive", title: "החלפת חברה", description: result.error ?? "החלפת החברה נכשלה" });
      return;
    }
    // A full load: every server component renders again in the other company.
    window.location.assign(
      `/tasks?task=${encodeURIComponent(initialTaskId)}&company=${encodeURIComponent(elsewhere.slug)}`,
    );
  }, [elsewhere, initialTaskId, toast]);

  // The board-wide list, narrowed by the owner filter first - every other count/filter
  // below reads from here so the tabs and the filter never disagree about what's on screen.
  const scoped = useMemo(() => {
    if (owner === "all") return tasks;
    return tasks.filter((task) => matchesOwner(task, owner, user?.id ?? null));
  }, [tasks, owner, user]);

  // What the owner filter offers, each with its OPEN count over the whole board - so an
  // admin sees who is carrying what before picking a name.
  const ownerOptions = useMemo(() => {
    const me = user?.id ?? null;
    const open = tasks.filter(isOpen);
    const count = (filter: OwnerFilter) => open.filter((task) => matchesOwner(task, filter, me)).length;
    return {
      all: open.length,
      mine: count("mine"),
      delegated: count("delegated"),
      late: count("late"),
      unassigned: count("unassigned"),
      people: (staff ?? [])
        .filter((member) => member.id !== me)
        .map((member) => ({ ...member, open: count(`user:${member.id}`) })),
    };
  }, [tasks, staff, user]);

  // The board lens (הכל / פיתוח / שיווק / תפעול) narrows BOTH the table and
  // the kanban - everything below (table view tabs + counts, and the
  // <KanbanBoard> tasks prop) reads from here, never from `scoped` directly.
  const boardFiltered = useMemo(
    () => filterByBoard(scoped, boardLens),
    [scoped, boardLens],
  );

  // The Kanban draws one card per GENERAL task - a sub-task is never a card of its own (Dor,
  // 05.10). A part the filters matched stands in for its general task (lib/tasks/subtasks.ts).
  const kanbanTasks = useMemo(() => generalTasks(boardFiltered, tasks), [boardFiltered, tasks]);

  // Counts for the lens buttons themselves - computed pre-lens (from `scoped`) so every
  // button shows what it would reveal. OPEN tasks only (Dor, 30.09): a total that includes
  // everything ever closed says nothing about the work that is left.
  const scopedOpen = useMemo(() => scoped.filter(isOpen), [scoped]);
  const boardCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of scopedOpen) counts.set(task.board, (counts.get(task.board) ?? 0) + 1);
    return counts;
  }, [scopedOpen]);

  const setBoardLens = useCallback(
    (board: (typeof TASK_BOARDS)[number] | "all") => {
      const params = new URLSearchParams(searchParams.toString());
      if (board === "all") params.delete("board");
      else params.set("board", board);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // A task in review is a pile of its own (Dor, 05.10): it leaves "Open" - which is the work
  // still to do - and waits under "In review" (lib/tasks/review.ts `taskViewOf`).
  const filtered = useMemo(
    () => boardFiltered.filter((task) => inTaskView(task.status, taskView)),
    [boardFiltered, taskView],
  );

  const sorted = useMemo(() => {
    const me = user?.id ?? null;
    return [...filtered].sort(
      (a, b) =>
        // Under "In review", what waits for MY check comes first.
        (taskView === "review" ? reviewRank(a, me) - reviewRank(b, me) : 0) ||
        (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) ||
        (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"),
    );
  }, [filtered, taskView, user]);

  // Each sub-task sits right under its general task when both are on screen; one whose parent
  // is filtered out stays where its own priority puts it.
  const ordered = useMemo(() => {
    const onScreen = new Set(sorted.map((task) => task.id));
    const under = new Map<string, TaskWithNames[]>();
    for (const task of sorted) {
      if (task.parent_id && onScreen.has(task.parent_id)) {
        const list = under.get(task.parent_id) ?? [];
        list.push(task);
        under.set(task.parent_id, list);
      }
    }
    const out: TaskWithNames[] = [];
    for (const task of sorted) {
      if (task.parent_id && onScreen.has(task.parent_id)) continue;
      out.push(task, ...(under.get(task.id) ?? []));
    }
    return out;
  }, [sorted]);

  // Bulk bar (admins): tick rows, then assign / move / set status in one go.
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const selectedIds = useMemo(
    () => Object.entries(rowSelection).filter(([, on]) => on).map(([id]) => id),
    [rowSelection],
  );
  const runBulk = useCallback(
    async (patch: { assignee_id?: string | null; board?: TaskBoard; status?: TaskStatus }, what: string) => {
      if (selectedIds.length === 0) return;
      setBulkBusy(true);
      try {
        const result = await bulkUpdateTasks(selectedIds, patch);
        if (!result.ok) {
          toast({ variant: "destructive", title: "העדכון נכשל", description: result.error });
          return;
        }
        toast({
          variant: result.mail === "failed" ? "destructive" : undefined,
          title: `${result.updated} משימות ${what}`,
          description:
            result.mail === "sent"
              ? "נשלח מייל אחד עם כל המשימות."
              : result.mail === "failed"
                ? "המייל לאחראי נכשל - תעדכן אותו ישירות."
                : result.mail === "skipped"
                  ? "לאחראי אין כתובת מייל."
                  : undefined,
        });
        setRowSelection({});
        reload();
      } finally {
        setBulkBusy(false);
      }
    },
    [selectedIds, toast, reload],
  );

  const counts = useMemo(() => {
    const piles = { open: 0, review: 0, done: 0, all: boardFiltered.length };
    for (const task of boardFiltered) piles[taskViewOf(task.status)] += 1;
    return piles;
  }, [boardFiltered]);

  // A task moved to review goes back to whoever opened it - say whether they were told.
  const sayReviewSent = useCallback(
    (mail: "sent" | "skipped" | "failed" | undefined) =>
      toast({
        variant: mail === "failed" ? "destructive" : undefined,
        title: "המשימה הועברה לבדיקה",
        description:
          mail === "sent"
            ? "נשלח מייל למי שפתח את המשימה - היא מחכה לו ב\"המשימות שלי\"."
            : mail === "failed"
              ? "המייל למי שפתח את המשימה נכשל - תעדכן אותו ישירות."
              : "לא נשלח מייל: אין למשימה בודק אחר (פתחת אותה בעצמך, או שאין לו כתובת מייל).",
      }),
    [toast],
  );

  const onStatus = useCallback(
    async (task: TaskWithNames, status: TaskStatus) => {
      const result = await setTaskStatus(task.id, status);
      if (!result.ok) {
        toast({
          variant: "destructive",
          title: "Update failed",
          description: result.error,
        });
        return;
      }
      if (status === "review") sayReviewSent(result.mail);
      reload();
    },
    [reload, toast, sayReviewSent],
  );

  // Same server call as the table's status <Select> (onStatus above), but
  // returning success/failure instead of void - that boolean is how
  // <KanbanBoard> knows whether to keep its optimistic move or roll it back.
  // The toast with the server's error happens here, once, either way.
  const onKanbanStatusChange = useCallback(
    async (id: string, status: TaskStatus) => {
      const result = await setTaskStatus(id, status);
      if (!result.ok) {
        toast({
          variant: "destructive",
          title: "Update failed",
          description: result.error,
        });
        return false;
      }
      if (status === "review") sayReviewSent(result.mail);
      reload();
      return true;
    },
    [reload, toast, sayReviewSent],
  );

  const onDelete = useCallback(
    async (task: TaskWithNames) => {
      const result = await deleteTask(task.id);
      if (!result.ok) {
        toast({
          variant: "destructive",
          title: "Delete failed",
          description: result.error,
        });
        return;
      }
      toast({ title: "Task deleted" });
      reload();
    },
    [reload, toast],
  );

  // The conversation opens UNDER the row (Alon, 18.09) - talking about a task
  // should not need the edit dialog. One open at a time.
  const [threadTaskId, setThreadTaskId] = useState<string | null>(null);
  const toggleThread = useCallback(
    (taskId: string) => setThreadTaskId((current) => (current === taskId ? null : taskId)),
    [],
  );
  // A thread that was shown is read (the server stamped it) - drop the row's marker now
  // instead of reloading the whole board for it.
  const markThreadRead = useCallback(
    (taskId: string) =>
      setTasks((prev) =>
        prev.some((task) => task.id === taskId && task.unread_count > 0)
          ? prev.map((task) => (task.id === taskId ? { ...task, unread_count: 0 } : task))
          : prev,
      ),
    [],
  );

  const columns = useMemo<ColumnDef<TaskWithNames>[]>(
    () => [
      {
        accessorKey: "title",
        header: "Task",
        cell: ({ row }) => {
          const parent = row.original.parent_id ? taskById.get(row.original.parent_id) : undefined;
          const parts = childrenOf.get(row.original.id) ?? [];
          const progress = parts.length > 0 ? subtaskProgress(parts) : null;
          return (
          <div className={cn("min-w-[220px] max-w-[420px]", parent && "border-s-2 border-border ps-3")}>
            {parent && (
              <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground" title={parent.title}>
                <CornerDownLeft className="h-3 w-3 shrink-0" />
                חלק מ: {parent.title}
              </p>
            )}
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{row.original.title}</span>
              {progress && (
                <Badge variant="outline" className="shrink-0 gap-1 text-[10px]" title="תתי-משימות שהושלמו">
                  <ListTree className="h-3 w-3" />
                  {progress.done}/{progress.total}
                </Badge>
              )}
              {SOURCE_BADGE[row.original.source] && (
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  {SOURCE_BADGE[row.original.source]}
                </Badge>
              )}
              {/* It came back to the viewer: its owner finished and waits for an answer. */}
              {awaitsReviewBy(row.original, user?.id ?? null) && (
                <Badge
                  className="shrink-0 text-[10px]"
                  title="מי שביצע סיים את החלק שלו. לאשר = Done, להחזיר לעבודה = In progress"
                >
                  לבדיקה שלך
                </Badge>
              )}
              {/* Past its deadline and the assignee has said nothing since (lib/tasks/reminders.ts). */}
              {row.original.late && (
                <Badge
                  variant="outline"
                  className="shrink-0 gap-1 border-destructive/50 text-[10px] text-destructive"
                  title="תאריך היעד עבר והאחראי לא הגיב, לא עדכן סטטוס ולא כתב כלום מאז"
                >
                  <AlarmClock className="h-3 w-3" />
                  באיחור, בלי מענה
                </Badge>
              )}
            </div>
            {row.original.description && (
              <p className="truncate text-xs text-muted-foreground">
                {row.original.description}
              </p>
            )}
            {row.original.source_ref?.url && (
              <Link
                href={row.original.source_ref.url}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <Wrench className="h-3 w-3" />
                Do: {row.original.source_ref.label}
              </Link>
            )}
            {row.original.site_url && (
              <a
                href={row.original.site_url}
                target="_blank"
                rel="noopener noreferrer"
                className="ms-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                באתר
              </a>
            )}
          </div>
          );
        },
      },
      {
        accessorKey: "assignee_name",
        header: "Assignee",
        cell: ({ row }) => (
          <div className="min-w-[120px]">
            <span className={cn(!row.original.assignee_name && "text-muted-foreground")}>
              {row.original.assignee_name ?? "Unassigned"}
            </span>
            {/* Only when someone was PICKED - the default reviewer (whoever opened it) is not repeated here. */}
            {row.original.reviewer_names.length > 0 && (
              <p
                className="truncate text-[11px] text-muted-foreground"
                title={`בודקים: ${row.original.reviewer_names.join(", ")}`}
              >
                בודק: {row.original.reviewer_names.join(", ")}
              </p>
            )}
          </div>
        ),
      },
      {
        accessorKey: "priority",
        header: "Priority",
        cell: ({ row }) => (
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold",
              PRIORITY_STYLE[row.original.priority],
            )}
          >
            {PRIORITY_LABEL[row.original.priority]}
          </span>
        ),
      },
      {
        accessorKey: "due_date",
        header: "Due",
        cell: ({ row }) =>
          row.original.due_date ? (
            <span className={cn("tabular text-sm", row.original.late && "font-semibold text-destructive")}>
              {row.original.due_date}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          // Admins, the owner, and - while it waits for their review - whoever opened it.
          return (
            <Select
              value={row.original.status}
              onValueChange={(value) => onStatus(row.original, value as TaskStatus)}
              disabled={!canChangeStatus(user?.role ?? "", row.original, user?.id ?? null)}
            >
              <SelectTrigger className="h-8 w-[130px]">
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
          );
        },
      },
      {
        id: "comments",
        header: "",
        // Always there, not only when someone already wrote: it is the visible
        // handle for "open the conversation" (a click anywhere on the row does the same).
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 gap-1 px-2 text-xs",
              row.original.comment_count > 0 ? "text-foreground" : "text-muted-foreground",
              row.original.unread_count > 0 && "font-semibold text-primary hover:text-primary",
              threadTaskId === row.original.id && "bg-muted",
            )}
            onClick={() => toggleThread(row.original.id)}
            aria-expanded={threadTaskId === row.original.id}
            title={
              row.original.unread_count > 0
                ? `${row.original.unread_count} תגובות חדשות שלא קראת`
                : "שיחה על המשימה"
            }
          >
            <MessageSquare className="h-3.5 w-3.5" />
            {row.original.comment_count > 0 ? row.original.comment_count : null}
            {row.original.unread_count > 0 && (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] leading-none text-primary-foreground">
                {row.original.unread_count === 1 ? "חדשה" : `${row.original.unread_count} חדשות`}
              </span>
            )}
          </Button>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) =>
          isManager ? (
            <div className="flex justify-end gap-1">
              <TaskRemindButton task={row.original} onSent={reload} />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setEditor({ open: true, task: row.original })}
                aria-label="Edit task"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive"
                onClick={() => onDelete(row.original)}
                aria-label="Delete task"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            // Not a manager: no edit/delete, but every row still opens - the
            // dialog itself decides read-only vs. status/progress editable
            // (see the `editable` prop on TaskEditor), and the thread is
            // always there to read and comment on regardless.
            <div className="flex justify-end gap-1">
              <TaskRemindButton task={row.original} onSent={reload} />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setEditor({ open: true, task: row.original })}
                aria-label="Open task"
              >
                <Eye className="h-4 w-4" />
              </Button>
            </div>
          ),
      },
    ],
    [isManager, user, onStatus, onDelete, threadTaskId, toggleThread, taskById, childrenOf, reload],
  );

  // Whose tasks are on screen - shared by the Tasks table and the Kanban. Everyone gets
  // "mine" and "the ones I assigned to others"; the per-person list is the admins'
  // (the staff list is admin-guarded, and it is their follow-up tool).
  const withCount = (label: string, open: number) => (
    <>
      {label} <span className="tabular text-muted-foreground">· {open}</span>
    </>
  );
  const ownerSelect = (
    <Select value={owner} onValueChange={(value) => setOwner(value as OwnerFilter)}>
      <SelectTrigger className="h-8 w-[210px]" dir="rtl" aria-label="של מי המשימות">
        <SelectValue />
      </SelectTrigger>
      <SelectContent dir="rtl">
        <SelectItem value="all">{withCount("כל המשימות", ownerOptions.all)}</SelectItem>
        <SelectItem value="mine">{withCount("המשימות שלי", ownerOptions.mine)}</SelectItem>
        <SelectItem value="delegated">{withCount("ששייכתי לאחרים", ownerOptions.delegated)}</SelectItem>
        <SelectItem value="late">{withCount("באיחור, בלי מענה", ownerOptions.late)}</SelectItem>
        {isManager && (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>לפי משתמש</SelectLabel>
              {ownerOptions.people.map((member) => (
                <SelectItem key={member.id} value={`user:${member.id}`}>
                  {withCount(member.name, member.open)}
                </SelectItem>
              ))}
              <SelectItem value="unassigned">{withCount("ללא שיוך", ownerOptions.unassigned)}</SelectItem>
            </SelectGroup>
          </>
        )}
      </SelectContent>
    </Select>
  );

  // The sub-tasks panel for one task (none on a sub-task - one level only).
  const subtasksPanel = (task: TaskWithNames) =>
    task.parent_id ? null : (
      <TaskSubtasks
        parent={task}
        subtasks={childrenOf.get(task.id) ?? []}
        staff={staff}
        isManager={isManager}
        userId={user?.id ?? null}
        role={user?.role ?? ""}
        onChanged={reload}
        onOpenTask={(sub) => setEditor({ open: true, task: sub })}
      />
    );

  return (
    // The open tab is written to `?tab=` - it was only ever READ from there, so a refresh
    // on Kanban landed back on the Tasks list.
    <UrlTabs
      defaultValue="tasks"
      values={tabIds}
      onValueChange={(next) => {
        // "Run now" on the rules tab creates tasks - refresh the board when leaving it.
        if (activeTabRef.current === "rules" && next !== "rules") reload();
        activeTabRef.current = next;
      }}
    >
      {/* Board lens - filters the table AND the kanban below it together. The plain board is
          one board, so it has no lens. */}
      {!plainBoard && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <FilterPill
            active={boardLens === "all"}
            onClick={() => setBoardLens("all")}
            label="הכל"
            count={scopedOpen.length}
            title="משימות פתוחות"
          />
          {TASK_BOARDS.map((board) => (
            <FilterPill
              key={board}
              active={boardLens === board}
              onClick={() => setBoardLens(board)}
              label={BOARD_META[board].label}
              count={boardCounts.get(board) ?? 0}
              title="משימות פתוחות"
            />
          ))}
        </div>
      )}

      {/* The task a link pointed at lives on the board of another company of mine. */}
      {elsewhere && (
        <div
          dir="rtl"
          className="mb-3 flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm"
        >
          <span className="flex-1">
            המשימה שבקישור לא נמצאת בלוח הזה - היא בלוח המשימות של {elsewhere.name}.
          </span>
          <Button size="sm" variant="outline" className="h-8" onClick={goToTaskCompany}>
            עבור ל-{elsewhere.name}
          </Button>
        </div>
      )}

      {/* Tasks I opened that went past their deadline with no word from the assignee (Dor, 01.10) -
          the same list the daily mail sends; the filter shows them. */}
      {ownerOptions.late > 0 && owner !== "late" && (
        <div
          dir="rtl"
          className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
        >
          <AlarmClock className="h-4 w-4 shrink-0 text-destructive" />
          <span className="flex-1">
            {ownerOptions.late === 1
              ? "משימה אחת שפתחת עברה את תאריך היעד, והאחראי עוד לא הגיב עליה."
              : `${ownerOptions.late} משימות שפתחת עברו את תאריך היעד, והאחראים עוד לא הגיבו עליהן.`}{" "}
            <span className="text-muted-foreground">אפשר לשלוח להם תזכורת בכפתור הפעמון.</span>
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={() => {
              setOwner("late");
              setView("open");
            }}
          >
            הצג אותן
          </Button>
        </div>
      )}

      <TabsList>
        <TabsTrigger value="tasks">Tasks</TabsTrigger>
        <TabsTrigger value="kanban">Kanban</TabsTrigger>
        {!plainBoard && (
          <>
            <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
            <TabsTrigger value="marketing">Marketing</TabsTrigger>
            <TabsTrigger value="gaps">Creative gaps</TabsTrigger>
            <TabsTrigger value="pricing">Pricing</TabsTrigger>
            {isManager && <TabsTrigger value="rules">Task rules</TabsTrigger>}
          </>
        )}
      </TabsList>

      <TabsContent value="tasks" className="mt-4">
        <DataTable
          columns={columns}
          data={ordered}
          getRowId={(task) => task.id}
          enableRowSelection={isManager}
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
          bulkActions={
            <>
              <Select
                value=""
                onValueChange={(value) =>
                  runBulk({ assignee_id: value === "unassigned" ? null : value }, "שויכו")
                }
                disabled={bulkBusy}
              >
                {/* text-foreground: the bar is bg-primary, and a trigger inherits its light text
                    onto its own light background - the placeholder was invisible. */}
                <SelectTrigger className="h-8 w-[160px] text-foreground">
                  <SelectValue placeholder="שייך ל…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">ללא שיוך</SelectItem>
                  {(staff ?? []).map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!plainBoard && (
                <Select
                  value=""
                  onValueChange={(value) => runBulk({ board: value as TaskBoard }, "הועברו")}
                  disabled={bulkBusy}
                >
                  <SelectTrigger className="h-8 w-[130px] text-foreground">
                    <SelectValue placeholder="ללוח…" />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_BOARDS.map((board) => (
                      <SelectItem key={board} value={board}>
                        {BOARD_META[board].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select
                value=""
                onValueChange={(value) => runBulk({ status: value as TaskStatus }, "עודכנו")}
                disabled={bulkBusy}
              >
                <SelectTrigger className="h-8 w-[130px] text-foreground">
                  <SelectValue placeholder="סטטוס…" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((status) => (
                    <SelectItem key={status} value={status}>
                      {STATUS_LABEL[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="ghost" onClick={() => setRowSelection({})} disabled={bulkBusy}>
                נקה בחירה
              </Button>
            </>
          }
          onRowClick={(task) => toggleThread(task.id)}
          expandedRowId={threadTaskId}
          renderExpandedRow={(task) => (
            <div className="max-w-3xl space-y-3" dir="auto">
              {task.description && (
                <p className="whitespace-pre-line text-sm text-muted-foreground">{task.description}</p>
              )}
              {subtasksPanel(task)}
              <TaskThread
                taskId={task.id}
                people={people}
                onCommentAdded={reload}
                onRead={() => markThreadRead(task.id)}
              />
            </div>
          )}
          searchColumn="title"
          searchPlaceholder="Search tasks..."
          views={[
            { id: "open", label: "Open", count: counts.open },
            { id: "review", label: "In review", count: counts.review },
            { id: "done", label: "Done", count: counts.done },
            { id: "all", label: "All", count: counts.all },
          ]}
          activeView={view}
          onViewChange={setView}
          filters={ownerSelect}
          rightActions={
            // A task opened while looking at one board starts on that board (still changeable
            // in the form) - Dor, 30.09.
            <Button
              size="sm"
              onClick={() =>
                setEditor({
                  open: true,
                  task: null,
                  defaults: boardLens === "all" ? undefined : { board: boardLens },
                })
              }
            >
              <Plus className="mr-1.5 h-4 w-4" />
              New task
            </Button>
          }
          emptyState={{
            title: loading
              ? "Loading tasks…"
              : taskView === "review"
                ? "Nothing is waiting for review"
                : "No tasks here",
            description: loading
              ? undefined
              : taskView === "review"
                ? "A task lands here when its owner sets it to In review."
                : plainBoard
                ? "Create one with New task."
                : "Create one, or pull work in from the Creative gaps tab.",
          }}
        />
      </TabsContent>

      <TabsContent value="kanban" className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {/* Same owner filter (and state) as the Tasks tab - it filters this board too. */}
          {ownerSelect}
          <span className="text-muted-foreground">קיבוץ:</span>
          <Select value={kanbanGroupBy} onValueChange={(value) => setGroupBy(value as GroupBy)}>
            <SelectTrigger className="h-8 w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">ללא</SelectItem>
              {/* Phases belong to the Mega Events dev board. */}
              {!plainBoard && <SelectItem value="phase">פאזה</SelectItem>}
              <SelectItem value="assignee">משובץ</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <KanbanBoard
          tasks={kanbanTasks}
          parts={childrenOf}
          onStatusChange={onKanbanStatusChange}
          groupBy={kanbanGroupBy}
          role={user?.role ?? ""}
          userId={user?.id ?? null}
          onOpenTask={(task) => setEditor({ open: true, task })}
        />
      </TabsContent>

      {/* The Mega Events tabs - never mounted on the plain board (the server refuses their
          actions there as well). */}
      {!plainBoard && (
        <>
          {/* Roadmap / Marketing read the WHOLE board (their own assignee filter inside), not the
              board lens or the my-tasks switch - they are the team map. */}
          <TabsContent value="roadmap" className="mt-4">
            <TaskMapView
              mode="roadmap"
              tasks={tasks}
              parts={childrenOf}
              loading={loading}
              onOpenTask={(task) => setEditor({ open: true, task })}
              onAddTask={(defaults) => setEditor({ open: true, task: null, defaults })}
            />
          </TabsContent>

          <TabsContent value="marketing" className="mt-4">
            <TaskMapView
              mode="marketing"
              tasks={tasks}
              parts={childrenOf}
              loading={loading}
              onOpenTask={(task) => setEditor({ open: true, task })}
              onAddTask={(defaults) => setEditor({ open: true, task: null, defaults })}
            />
          </TabsContent>

          <TabsContent value="gaps" className="mt-4">
            <GapsTab
              onCreateTask={(gap) =>
                setEditor({ open: true, task: null, prefill: gapPrefill(gap) })
              }
            />
          </TabsContent>

          <TabsContent value="pricing" className="mt-4">
            <PricingGapsTab
              onOpenTask={(taskId) => {
                const found = tasks.find((t) => t.id === taskId);
                if (found) setEditor({ open: true, task: found });
              }}
              onTasksChanged={reload}
            />
          </TabsContent>

          {isManager && (
            <TabsContent value="rules" className="mt-4">
              <RulesTab />
            </TabsContent>
          )}
        </>
      )}

      <TaskEditor
        key={`${editor.task?.id ?? "new"}-${editor.prefill?.source_ref.row_id ?? ""}-${editor.defaults?.board ?? ""}${editor.defaults?.phase ?? ""}${editor.defaults?.channel ?? ""}-${editor.open}`}
        state={editor}
        isManager={isManager}
        plainBoard={plainBoard}
        people={people}
        editable={editableFields(
          user?.role ?? "",
          !!user && editor.task?.assignee_id === user.id,
          !!user && editor.task?.created_by === user.id,
        )}
        onClose={() => setEditor({ open: false, task: null })}
        onThreadRead={markThreadRead}
        onSaved={() => {
          setEditor({ open: false, task: null });
          reload();
        }}
      >
        {editor.task ? subtasksPanel(editor.task) : null}
      </TaskEditor>
    </UrlTabs>
  );
}

/**
 * Everything missing on the site, as one list. No type filter on purpose - the
 * point is a single work queue you scan top to bottom, most severe first.
 *
 * Two buttons per row, and the distinction matters: "Do" jumps to the exact
 * control that fixes it (the crest field, the gallery picker, the generator
 * with the event already chosen), while "Create task" hands the job to
 * someone else instead.
 */
function GapsTab({ onCreateTask }: { onCreateTask: (gap: GapItem) => void }) {
  const { toast } = useToast();
  const [items, setItems] = useState<GapItem[] | null>(null);
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<DismissedGap[]>([]);
  const [showDismissed, setShowDismissed] = useState(false);
  // "All" is the default; picking a type narrows the queue to that asset only.
  const [kindFilter, setKindFilter] = useState<GapKind | "all">("all");

  const countsByKind = useMemo(() => {
    const counts = new Map<GapKind, number>();
    for (const item of items ?? []) {
      counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  // Fall back to "all" when the picked type empties out (fixed or dismissed).
  const activeKind =
    kindFilter !== "all" && (countsByKind.get(kindFilter) ?? 0) > 0
      ? kindFilter
      : "all";

  const visible = useMemo(
    () =>
      activeKind === "all"
        ? (items ?? [])
        : (items ?? []).filter((item) => item.kind === activeKind),
    [items, activeKind],
  );

  const load = useCallback(() => {
    listAllCreativeGaps().then(setItems);
    openTaskGapKeys().then((keys) => setTaken(new Set(keys)));
    listDismissedGaps().then(setDismissed);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** "Already on the site" - files the gap away without touching the row. */
  const markAlreadyDone = async (item: GapItem) => {
    setItems((current) =>
      current
        ? current.filter(
            (candidate) =>
              gapKey(candidate.kind, candidate.table, candidate.row_id) !==
              gapKey(item.kind, item.table, item.row_id),
          )
        : current,
    );
    const result = await dismissCreativeGap({
      kind: item.kind,
      table: item.table,
      row_id: item.row_id,
      label: item.label,
    });
    if (!result.ok) {
      toast({ variant: "destructive", title: "Failed", description: result.error });
    }
    load();
  };

  const undoDismissal = async (key: string) => {
    const result = await restoreCreativeGap(key);
    if (!result.ok) {
      toast({ variant: "destructive", title: "Failed", description: result.error });
      return;
    }
    load();
  };

  if (items === null) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center">
        <p className="font-medium">Nothing is missing</p>
        <p className="text-sm text-muted-foreground">
          Every team, artist, category and upcoming event has its visuals.
          {dismissed.length > 0 && ` ${dismissed.length} were marked as already on the site.`}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span>
          <span className="font-medium tabular-nums text-foreground">{items.length}</span>{" "}
          missing assets, most blocking first - artists and teams with packages
          on sale now come before the wishlist.
        </span>
        {dismissed.length > 0 && (
          <button
            type="button"
            onClick={() => setShowDismissed((open) => !open)}
            className="underline underline-offset-2 hover:text-foreground"
          >
            {dismissed.length} marked as already on the site
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <FilterPill
          active={activeKind === "all"}
          onClick={() => setKindFilter("all")}
          label="All"
          count={items.length}
        />
        {GAP_KINDS.filter((kind) => (countsByKind.get(kind) ?? 0) > 0).map(
          (kind) => (
            <FilterPill
              key={kind}
              active={activeKind === kind}
              onClick={() => setKindFilter(kind)}
              label={GAP_META[kind].short}
              count={countsByKind.get(kind) ?? 0}
              severity={GAP_META[kind].severity}
            />
          ),
        )}
      </div>

      {showDismissed && dismissed.length > 0 && (
        <div className="rounded-lg border bg-muted/40 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Already on the site
          </p>
          <div className="flex flex-wrap gap-2">
            {dismissed.map((entry) => (
              <span
                key={entry.gap_key}
                className="inline-flex items-center gap-2 rounded-full border bg-card px-2.5 py-1 text-xs"
              >
                <span className="text-muted-foreground">
                  {GAP_META[entry.kind as keyof typeof GAP_META]?.short ?? entry.kind}
                </span>
                <span className="font-medium">{entry.label}</span>
                <button
                  type="button"
                  onClick={() => undoDismissal(entry.gap_key)}
                  title="Put it back on the list"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Missing</th>
              <th className="px-3 py-2 text-left font-semibold">Item</th>
              <th className="px-3 py-2 text-left font-semibold">Detail</th>
              <th className="w-72 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => {
              const meta = GAP_META[item.kind];
              const key = gapKey(item.kind, item.table, item.row_id);
              const hasTask = taken.has(key);
              const live = item.liveEvents ?? 0;
              return (
                <tr key={key} className="border-t">
                  <td className="whitespace-nowrap px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold",
                        meta.severity === "crit"
                          ? "bg-destructive/15 text-destructive"
                          : "bg-warning-muted text-warning",
                      )}
                    >
                      {meta.short}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <Link href={item.url} className="font-medium hover:underline">
                        {item.label}
                      </Link>
                      {live > 0 && (
                        <span
                          title="חבילות זמינות באתר עכשיו - לא ב-wishlist"
                          className="inline-flex items-center rounded-full bg-success-muted px-2 py-0.5 text-[11px] font-semibold text-success"
                        >
                          {live} on sale
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{item.detail ?? ""}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      {item.siteUrl && (
                        <Button size="sm" variant="ghost" asChild>
                          <a href={item.siteUrl} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                            באתר
                          </a>
                        </Button>
                      )}
                      <Button size="sm" asChild>
                        <Link href={item.fixUrl}>
                          <Wrench className="mr-1.5 h-3.5 w-3.5" />
                          Do
                        </Link>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={hasTask}
                        onClick={() => onCreateTask(item)}
                      >
                        {hasTask ? "Task exists" : "Create task"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Already on the site - stop reporting it"
                        onClick={() => markAlreadyDone(item)}
                      >
                        <Check className="mr-1.5 h-3.5 w-3.5" />
                        Done
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  label,
  count,
  severity,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  severity?: "crit" | "warn";
  /** What the number counts, when the label alone does not say. */
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-transparent bg-primary text-primary-foreground"
          : "bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {severity && (
        <span
          aria-hidden
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            active
              ? "bg-primary-foreground/70"
              : severity === "crit"
                ? "bg-destructive"
                : "bg-warning",
          )}
        />
      )}
      {label}
      <span className={cn("tabular", active ? "opacity-80" : "text-muted-foreground")}>
        {count}
      </span>
    </button>
  );
}
