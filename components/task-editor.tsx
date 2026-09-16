"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { createTask, updateTask } from "@/lib/actions/task-actions";
import { listUsers } from "@/lib/actions/user-actions";
import { TaskThread } from "@/components/task-thread";
import { BOARD_META, CHANNEL_META, PHASES } from "@/lib/task-boards";
import { TASK_FIELDS, type EditableTaskField } from "@/lib/tasks/permissions";
import { STAFF_ROLES, type UserProfile } from "@/types/auth.types";
import {
  MKT_CHANNELS,
  TASK_BOARDS,
  TASK_PRIORITIES,
  type MktChannel,
  type TaskBoard,
  type TaskPriority,
  type TaskSource,
  type TaskSourceRef,
  type TaskWithNames,
} from "@/types/task.types";
import { Slider } from "@/components/ui/slider";

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/**
 * What a sourced task is born with - the gaps tab and the price-changes
 * screen both open the editor this way. `source_ref.url` is the deep link the
 * assignee lands on ("Do"), so pass the fixing control, not the page.
 */
export interface TaskPrefill {
  title: string;
  description?: string;
  priority?: TaskPriority;
  source: Exclude<TaskSource, "manual">;
  source_ref: TaskSourceRef;
  /** Shown as a small note under the form ("From creative gap: Liverpool"). */
  origin: string;
}

export interface TaskEditorState {
  open: boolean;
  /** null = creating */
  task: TaskWithNames | null;
  prefill?: TaskPrefill;
  /** New-task placement from the Roadmap / Marketing tabs ("+" in a phase or channel). */
  defaults?: { board: TaskBoard; phase?: number | null; channel?: MktChannel | null };
}

/**
 * The one task dialog: create (blank or prefilled from a source) and edit.
 * Loads the staff list itself when the viewer is a manager (listUsers is
 * admin-guarded), so any screen can open it without wiring users through.
 */
export function TaskEditor({
  state,
  isManager,
  editable,
  onClose,
  onSaved,
}: {
  state: TaskEditorState;
  isManager: boolean;
  /** Fields the current viewer may change on THIS task (ignored while creating -
   *  any staff member can fill in a new task for themself). Empty on an
   *  existing task = read-only: the form still renders and the thread still
   *  takes comments, there's just nothing to save. Omitted by callers that
   *  only ever open this for a manager (price-changes) - falls back to
   *  everything/nothing by `isManager`, same as before this field existed. */
  editable?: Set<EditableTaskField>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const { task, prefill } = state;
  const fields = editable ?? new Set<EditableTaskField>(isManager ? TASK_FIELDS : []);
  const canEdit = (field: EditableTaskField) => !task || fields.has(field);
  const readOnly = !!task && fields.size === 0;

  const [title, setTitle] = useState(task?.title ?? prefill?.title ?? "");
  const [description, setDescription] = useState(
    task?.description ?? prefill?.description ?? "",
  );
  const [priority, setPriority] = useState<TaskPriority>(
    task?.priority ?? prefill?.priority ?? "medium",
  );
  const [assignee, setAssignee] = useState<string>(task?.assignee_id ?? "unassigned");
  const [dueDate, setDueDate] = useState(task?.due_date ?? "");
  const { defaults } = state;
  const [board, setBoard] = useState<TaskBoard>(task?.board ?? defaults?.board ?? "ops");
  const [phase, setPhase] = useState<number | null>(
    task ? (task.phase ?? null) : defaults?.board === "dev" ? (defaults.phase ?? null) : null,
  );
  const [channel, setChannel] = useState<MktChannel | null>(
    task ? (task.channel ?? null) : defaults?.board === "marketing" ? (defaults.channel ?? null) : null,
  );
  const [progress, setProgress] = useState<number>(task?.progress ?? 0);
  const [saving, setSaving] = useState(false);
  const [staff, setStaff] = useState<UserProfile[]>([]);

  // A board switch drops the fields the OLD board owned - otherwise a task
  // moved from marketing to dev keeps a ghost channel/progress (or a dev task
  // keeps a phase after becoming a marketing one).
  const onBoardChange = (value: string) => {
    const next = value as TaskBoard;
    setBoard(next);
    if (next !== "dev") setPhase(null);
    if (next !== "marketing") {
      setChannel(null);
      setProgress(0);
    }
  };

  useEffect(() => {
    if (!state.open || !isManager) return;
    listUsers().then((users) =>
      setStaff(
        users.filter(
          (candidate) =>
            candidate.is_active &&
            (STAFF_ROLES as readonly string[]).includes(candidate.role),
        ),
      ),
    );
  }, [state.open, isManager]);

  const submit = async () => {
    setSaving(true);
    try {
      const assigneeId = assignee === "unassigned" ? null : assignee;
      // Belt and suspenders on top of onBoardChange - never send a phase/channel
      // that doesn't belong to the selected board.
      const effectivePhase = board === "dev" ? phase : null;
      const effectiveChannel = board === "marketing" ? channel : null;
      const effectiveProgress = board === "marketing" ? progress : null;
      // On an existing task, send only the fields THIS viewer may change - an
      // editor's patch never carries a key updateTask would reject (title,
      // board, assignee...), even though the (disabled) inputs still show them.
      const result = task
        ? await updateTask(task.id, {
            ...(canEdit("title") ? { title } : {}),
            ...(canEdit("description") ? { description: description || null } : {}),
            ...(canEdit("priority") ? { priority } : {}),
            ...(canEdit("assignee_id") ? { assignee_id: assigneeId } : {}),
            ...(canEdit("due_date") ? { due_date: dueDate || null } : {}),
            ...(canEdit("board") ? { board } : {}),
            ...(canEdit("phase") ? { phase: effectivePhase } : {}),
            ...(canEdit("channel") ? { channel: effectiveChannel } : {}),
            ...(canEdit("progress") ? { progress: effectiveProgress } : {}),
          })
        : await createTask({
            title,
            description: description || null,
            priority,
            assignee_id: assigneeId,
            due_date: dueDate || null,
            source: prefill?.source ?? "manual",
            source_ref: prefill?.source_ref ?? null,
            board,
            phase: effectivePhase,
            channel: effectiveChannel,
            progress: effectiveProgress,
          });
      if (!result.ok) {
        toast({
          variant: "destructive",
          title: "Save failed",
          description: result.error,
        });
        return;
      }
      toast({
        title: task ? "Task updated" : "Task created",
        description:
          !task && assigneeId ? "The assignee gets an email." : undefined,
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={state.open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={cn("sm:max-w-md", task && "flex max-h-[85vh] flex-col overflow-y-auto sm:max-w-lg")}
      >
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
              disabled={!canEdit("title")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-desc">Description</Label>
            <Textarea
              id="task-desc"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              disabled={!canEdit("description")}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={priority}
                onValueChange={(value) => setPriority(value as TaskPriority)}
                disabled={!canEdit("priority")}
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
                disabled={!canEdit("due_date")}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Board</Label>
            <Select value={board} onValueChange={onBoardChange} disabled={!canEdit("board")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASK_BOARDS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {BOARD_META[value].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {board === "dev" && (
            <div className="space-y-2">
              <Label>Phase</Label>
              <Select
                value={phase === null ? "none" : String(phase)}
                onValueChange={(value) => setPhase(value === "none" ? null : Number(value))}
                disabled={!canEdit("phase")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">ללא</SelectItem>
                  {Object.entries(PHASES).map(([value, meta]) => (
                    <SelectItem key={value} value={value}>
                      {value}. {meta.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {board === "marketing" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Channel</Label>
                <Select
                  value={channel ?? "none"}
                  onValueChange={(value) =>
                    setChannel(value === "none" ? null : (value as MktChannel))
                  }
                  disabled={!canEdit("channel")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">ללא</SelectItem>
                    {MKT_CHANNELS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {CHANNEL_META[value].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Progress ({progress}%)</Label>
                <Slider
                  className="mt-3"
                  value={[progress]}
                  min={0}
                  max={100}
                  step={5}
                  onValueChange={(values) => setProgress(values[0] ?? 0)}
                  disabled={!canEdit("progress")}
                />
              </div>
            </div>
          )}
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
              <p className="text-xs text-muted-foreground">
                Assigning someone else sends them an email with the task.
              </p>
            </div>
          )}
          {prefill && (
            <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
              {prefill.origin}
            </p>
          )}
        </div>

        {/* No thread on a brand-new task - there is no task id to hang comments off yet. */}
        {task && (
          <div className="mt-2 border-t pt-4">
            <TaskThread taskId={task.id} />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {!readOnly && (
            <Button onClick={submit} disabled={saving || !title.trim()}>
              {saving ? "Saving…" : task ? "Save changes" : "Create task"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
