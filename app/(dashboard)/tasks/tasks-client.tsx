"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createTask,
  deleteTask,
  listTasks,
  openTaskGapKeys,
  setTaskStatus,
  updateTask,
} from "@/lib/actions/task-actions";
import {
  getCreativeGapCounts,
  listCreativeGaps,
} from "@/lib/actions/creative-gap-actions";
import { listUsers } from "@/lib/actions/user-actions";
import { ADMIN_ROLES, STAFF_ROLES, type UserProfile } from "@/types/auth.types";
import {
  GAP_KINDS,
  GAP_META,
  type GapCounts,
  type GapItem,
  type GapKind,
} from "@/types/creative-gap.types";
import {
  PRIORITY_ORDER,
  TASK_PRIORITIES,
  type TaskPriority,
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

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

type EditorState = {
  open: boolean;
  /** null = creating */
  task: TaskWithNames | null;
  /** Prefill when a task is born from a creative gap. */
  gap?: GapItem;
};

export function TasksClient() {
  const { user } = useAuth();
  const { toast } = useToast();
  // /tasks?tab=gaps deep-links straight to the gaps tab (dashboard panel).
  const initialTab = useSearchParams().get("tab") === "gaps" ? "gaps" : "tasks";
  const isManager = !!user && (ADMIN_ROLES as readonly string[]).includes(user.role);

  const [tasks, setTasks] = useState<TaskWithNames[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("open");
  const [staff, setStaff] = useState<UserProfile[]>([]);
  const [editor, setEditor] = useState<EditorState>({ open: false, task: null });

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

  // Assignee picker is manager-only (listUsers is admin-guarded anyway).
  useEffect(() => {
    if (!isManager) return;
    listUsers().then((users) =>
      setStaff(
        users.filter(
          (candidate) =>
            candidate.is_active &&
            (STAFF_ROLES as readonly string[]).includes(candidate.role),
        ),
      ),
    );
  }, [isManager]);

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
              {row.original.source === "creative_gap" && (
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  creative
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
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                {row.original.source_ref.label}
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
        <GapsTab onCreateTask={(gap) => setEditor({ open: true, task: null, gap })} />
      </TabsContent>

      <TaskEditor
        key={`${editor.task?.id ?? "new"}-${editor.gap?.row_id ?? ""}-${editor.open}`}
        state={editor}
        isManager={isManager}
        staff={staff}
        onClose={() => setEditor({ open: false, task: null })}
        onSaved={() => {
          setEditor({ open: false, task: null });
          reload();
        }}
      />
    </Tabs>
  );
}

function TaskEditor({
  state,
  isManager,
  staff,
  onClose,
  onSaved,
}: {
  state: EditorState;
  isManager: boolean;
  staff: UserProfile[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const { task, gap } = state;

  const [title, setTitle] = useState(
    task?.title ?? (gap ? `${GAP_META[gap.kind].label}: ${gap.label}` : ""),
  );
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "medium");
  const [assignee, setAssignee] = useState<string>(task?.assignee_id ?? "unassigned");
  const [dueDate, setDueDate] = useState(task?.due_date ?? "");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const assigneeId = assignee === "unassigned" ? null : assignee;
      const result = task
        ? await updateTask(task.id, {
            title,
            description: description || null,
            priority,
            assignee_id: assigneeId,
            due_date: dueDate || null,
          })
        : await createTask({
            title,
            description: description || null,
            priority,
            assignee_id: assigneeId,
            due_date: dueDate || null,
            source: gap ? "creative_gap" : "manual",
            source_ref: gap
              ? {
                  kind: gap.kind,
                  table: gap.table,
                  row_id: gap.row_id,
                  label: gap.label,
                  url: gap.url,
                }
              : null,
          });
      if (!result.ok) {
        toast({
          variant: "destructive",
          title: "Save failed",
          description: result.error,
        });
        return;
      }
      toast({ title: task ? "Task updated" : "Task created" });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={state.open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What needs doing?"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-desc">Description</Label>
            <Textarea
              id="task-desc"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={priority}
                onValueChange={(value) => setPriority(value as TaskPriority)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {PRIORITY_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-due">Due date</Label>
              <Input
                id="task-due"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
          </div>
          {isManager && (
            <div className="space-y-2">
              <Label>Assign to</Label>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {staff.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.display_name || member.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {gap && (
            <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
              From creative gap: {gap.label}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !title.trim()}>
            {saving ? "Saving…" : task ? "Save changes" : "Create task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GapsTab({ onCreateTask }: { onCreateTask: (gap: GapItem) => void }) {
  const [counts, setCounts] = useState<GapCounts | null>(null);
  const [kind, setKind] = useState<GapKind>("event_creative");
  const [items, setItems] = useState<GapItem[]>([]);
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getCreativeGapCounts().then(setCounts);
    openTaskGapKeys().then((keys) => setTaken(new Set(keys)));
  }, []);

  useEffect(() => {
    setLoading(true);
    listCreativeGaps(kind)
      .then(setItems)
      .finally(() => setLoading(false));
  }, [kind]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {GAP_KINDS.map((gapKind) => {
          const meta = GAP_META[gapKind];
          const count = counts?.counts[gapKind];
          const isActive = kind === gapKind;
          return (
            <button
              key={gapKind}
              type="button"
              onClick={() => setKind(gapKind)}
              className={cn(
                "rounded-lg border bg-card p-3 text-right transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive ? "border-primary" : "hover:bg-muted/60",
              )}
              dir="rtl"
            >
              <div
                className={cn(
                  "font-display text-xl font-bold tabular-nums",
                  meta.severity === "crit" && (count ?? 0) > 0 && "text-destructive",
                )}
              >
                {count ?? "…"}
              </div>
              <div className="text-xs leading-snug text-muted-foreground">
                {meta.label}
              </div>
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-left">Detail</th>
              <th className="w-40 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={3} className="px-3 py-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-8 text-center text-muted-foreground">
                  Nothing missing here 🎉
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const key = `${item.table}:${item.row_id}`;
                const hasTask = taken.has(key);
                return (
                  <tr key={key} className="border-t">
                    <td className="px-3 py-2">
                      <Link href={item.url} className="font-medium hover:underline">
                        {item.label}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {item.detail ?? ""}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant={hasTask ? "outline" : "default"}
                        disabled={hasTask}
                        onClick={() => onCreateTask(item)}
                      >
                        {hasTask ? "Task exists" : "Create task"}
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {items.length >= 300 && (
        <p className="text-xs text-muted-foreground">
          Showing the first 300 - fix some and refresh.
        </p>
      )}
    </div>
  );
}
