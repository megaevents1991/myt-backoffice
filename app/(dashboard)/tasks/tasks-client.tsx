"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, Pencil, Plus, RotateCcw, Trash2, Wrench } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PRIORITY_LABEL,
  TaskEditor,
  type TaskEditorState,
  type TaskPrefill,
} from "@/components/task-editor";
import {
  deleteTask,
  listTasks,
  openTaskGapKeys,
  setTaskStatus,
} from "@/lib/actions/task-actions";
import {
  dismissCreativeGap,
  listAllCreativeGaps,
  listDismissedGaps,
  restoreCreativeGap,
  type DismissedGap,
} from "@/lib/actions/creative-gap-actions";
import { ADMIN_ROLES } from "@/types/auth.types";
import {
  GAP_KINDS,
  GAP_META,
  gapKey,
  type GapItem,
  type GapKind,
} from "@/types/creative-gap.types";
import {
  PRIORITY_ORDER,
  type TaskPriority,
  type TaskSource,
  type TaskStatus,
  type TaskWithNames,
} from "@/types/task.types";

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

const PRIORITY_STYLE: Record<TaskPriority, string> = {
  urgent: "bg-destructive/15 text-destructive",
  high: "bg-warning-muted text-warning",
  medium: "bg-info-muted text-info",
  low: "bg-muted text-muted-foreground",
};

/** Small badge on sourced tasks - where the work came from. */
const SOURCE_BADGE: Partial<Record<TaskSource, string>> = {
  creative_gap: "creative",
  price_review: "price",
};

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

export function TasksClient() {
  const { user } = useAuth();
  const { toast } = useToast();
  // /tasks?tab=gaps deep-links straight to the gaps tab (dashboard panel).
  const initialTab = useSearchParams().get("tab") === "gaps" ? "gaps" : "tasks";
  const isManager = !!user && (ADMIN_ROLES as readonly string[]).includes(user.role);

  const [tasks, setTasks] = useState<TaskWithNames[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("open");
  const [editor, setEditor] = useState<TaskEditorState>({ open: false, task: null });

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

  const filtered = useMemo(() => {
    switch (view) {
      case "open":
        return tasks.filter(
          (task) => task.status === "todo" || task.status === "in_progress",
        );
      case "done":
        return tasks.filter(
          (task) => task.status === "done" || task.status === "cancelled",
        );
      default:
        return tasks;
    }
  }, [tasks, view]);

  const sorted = useMemo(
    () =>
      [...filtered].sort(
        (a, b) =>
          (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) ||
          (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"),
      ),
    [filtered],
  );

  const counts = useMemo(() => {
    const open = tasks.filter(
      (task) => task.status === "todo" || task.status === "in_progress",
    ).length;
    return { open, done: tasks.length - open, all: tasks.length };
  }, [tasks]);

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
      reload();
    },
    [reload, toast],
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

  const columns = useMemo<ColumnDef<TaskWithNames>[]>(
    () => [
      {
        accessorKey: "title",
        header: "Task",
        cell: ({ row }) => (
          <div className="min-w-[220px] max-w-[420px]">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{row.original.title}</span>
              {SOURCE_BADGE[row.original.source] && (
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  {SOURCE_BADGE[row.original.source]}
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
          </div>
        ),
      },
      {
        accessorKey: "assignee_name",
        header: "Assignee",
        cell: ({ row }) => (
          <span className={cn(!row.original.assignee_name && "text-muted-foreground")}>
            {row.original.assignee_name ?? "Unassigned"}
          </span>
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
            <span className="tabular text-sm">{row.original.due_date}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Select
            value={row.original.status}
            onValueChange={(value) => onStatus(row.original, value as TaskStatus)}
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
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) =>
          isManager ? (
            <div className="flex justify-end gap-1">
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
          ) : null,
      },
    ],
    [isManager, onStatus, onDelete],
  );

  return (
    <Tabs defaultValue={initialTab}>
      <TabsList>
        <TabsTrigger value="tasks">Tasks</TabsTrigger>
        <TabsTrigger value="gaps">Creative gaps</TabsTrigger>
      </TabsList>

      <TabsContent value="tasks" className="mt-4">
        <DataTable
          columns={columns}
          data={sorted}
          searchColumn="title"
          searchPlaceholder="Search tasks..."
          views={[
            { id: "open", label: "Open", count: counts.open },
            { id: "done", label: "Done", count: counts.done },
            { id: "all", label: "All", count: counts.all },
          ]}
          activeView={view}
          onViewChange={setView}
          rightActions={
            <Button size="sm" onClick={() => setEditor({ open: true, task: null })}>
              <Plus className="mr-1.5 h-4 w-4" />
              New task
            </Button>
          }
          emptyState={{
            title: loading ? "Loading tasks…" : "No tasks here",
            description: loading
              ? undefined
              : "Create one, or pull work in from the Creative gaps tab.",
          }}
        />
      </TabsContent>

      <TabsContent value="gaps" className="mt-4">
        <GapsTab
          onCreateTask={(gap) =>
            setEditor({ open: true, task: null, prefill: gapPrefill(gap) })
          }
        />
      </TabsContent>

      <TaskEditor
        key={`${editor.task?.id ?? "new"}-${editor.prefill?.source_ref.row_id ?? ""}-${editor.open}`}
        state={editor}
        isManager={isManager}
        onClose={() => setEditor({ open: false, task: null })}
        onSaved={() => {
          setEditor({ open: false, task: null });
          reload();
        }}
      />
    </Tabs>
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
              <th className="w-52 px-3 py-2" />
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
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  severity?: "crit" | "warn";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
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
