"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, ListTree, Paperclip, Plus, X } from "lucide-react";

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
import { attachFilesToNewTask, listStaffForMentions } from "@/lib/actions/task-comment-actions";
import type { StaffMentionOption } from "@/types/task-comment.types";
import { listUsers } from "@/lib/actions/user-actions";
import { TaskThread } from "@/components/task-thread";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_BYTES,
  MAX_ATTACHMENTS_PER_SEND,
  isAttachableFile,
  isImageMime,
  uploadTaskFile,
} from "@/lib/tasks/attachment-upload";
import type { TaskMailOutcome } from "@/lib/services/task-notify";
import type { TaskAttachment } from "@/types/task-comment.types";
import { BOARD_META, CHANNEL_META, PHASES, defaultBoardFor } from "@/lib/task-boards";
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
  /** New-task placement: the board lens on /tasks, or "+" in a Roadmap phase / Marketing channel. */
  defaults?: { board: TaskBoard; phase?: number | null; channel?: MktChannel | null };
}

/** A file picked in the New-task form - uploaded only once the task exists (it needs the id). */
interface DraftFile {
  id: string;
  file: File;
  /** Local blob URL for an image's thumbnail; null for a PDF. */
  previewUrl: string | null;
}

/** A sub-task typed in the New-task form - created right after its parent. */
interface DraftPart {
  id: string;
  title: string;
  /** A staff id, or "unassigned". */
  assignee: string;
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
  onThreadRead,
  children,
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
  /** The dialog's thread was shown (= stamped read) - /tasks drops that row's unread marker. */
  onThreadRead?: (taskId: string) => void;
  /** Shown above the thread on an existing task - /tasks puts the sub-tasks panel here. */
  children?: React.ReactNode;
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
  const [board, setBoard] = useState<TaskBoard>(
    task?.board ?? defaults?.board ?? defaultBoardFor(prefill?.source ?? "manual"),
  );
  const [phase, setPhase] = useState<number | null>(
    task ? (task.phase ?? null) : defaults?.board === "dev" ? (defaults.phase ?? null) : null,
  );
  const [channel, setChannel] = useState<MktChannel | null>(
    task ? (task.channel ?? null) : defaults?.board === "marketing" ? (defaults.channel ?? null) : null,
  );
  const [progress, setProgress] = useState<number>(task?.progress ?? 0);
  const [saving, setSaving] = useState(false);
  const [staff, setStaff] = useState<UserProfile[]>([]);
  // Who the task goes back to in review (Dor, 30.09: "Alon opened it, but Tom checks it, or
  // both"). Empty = the default (whoever opened it). The picker's staff list is the
  // requireStaff one, so an editor can name a reviewer for a task they create themself.
  const [reviewerIds, setReviewerIds] = useState<string[]>(task?.reviewer_ids ?? []);
  const [reviewerOptions, setReviewerOptions] = useState<StaffMentionOption[]>([]);
  useEffect(() => {
    if (!state.open) return;
    listStaffForMentions()
      .then(setReviewerOptions)
      .catch((error) => console.error("task-editor: staff list failed", error));
  }, [state.open]);
  const reviewerName = (id: string) => {
    const person = reviewerOptions.find((option) => option.id === id);
    return person ? person.display_name || person.email : "…";
  };

  // New task only (Dor, 30.09): files and sub-tasks can be added before the task exists.
  // Both need the new task's id, so they are held here and written right after createTask.
  const [files, setFiles] = useState<DraftFile[]>([]);
  const [parts, setParts] = useState<DraftPart[]>([]);
  const [partTitle, setPartTitle] = useState("");
  const [partAssignee, setPartAssignee] = useState("unassigned");
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Live thumbnail blob URLs, tracked outside state so the unmount cleanup sees them all.
  const previewUrlsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const urls = previewUrlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const addFiles = (picked: File[]) => {
    const room = MAX_ATTACHMENTS_PER_SEND - files.length;
    const next: DraftFile[] = [];
    for (const file of picked) {
      if (!isAttachableFile(file)) {
        toast({ variant: "destructive", title: `${file.name}: אפשר לצרף תמונה או PDF` });
        continue;
      }
      if (!isImageMime(file.type) && file.size > ATTACHMENT_MAX_BYTES) {
        toast({ variant: "destructive", title: `${file.name}: הקובץ גדול מ-2.5MB` });
        continue;
      }
      if (next.length >= room) {
        toast({ variant: "destructive", title: `עד ${MAX_ATTACHMENTS_PER_SEND} קבצים למשימה חדשה` });
        break;
      }
      let previewUrl: string | null = null;
      if (isImageMime(file.type)) {
        previewUrl = URL.createObjectURL(file);
        previewUrlsRef.current.add(previewUrl);
      }
      next.push({ id: crypto.randomUUID(), file, previewUrl });
    }
    if (next.length > 0) setFiles((prev) => [...prev, ...next]);
  };

  const removeFile = (id: string) =>
    setFiles((prev) => {
      const target = prev.find((draft) => draft.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
        previewUrlsRef.current.delete(target.previewUrl);
      }
      return prev.filter((draft) => draft.id !== id);
    });

  const addPart = () => {
    const name = partTitle.trim();
    if (!name) return;
    setParts((prev) => [...prev, { id: crypto.randomUUID(), title: name, assignee: partAssignee }]);
    setPartTitle("");
  };

  /** Everything the New-task form holds beyond the task's own fields. Returns what did NOT
   *  go through - the task itself is already saved, so nothing here may throw past it. */
  const saveExtras = async (newId: string): Promise<string[]> => {
    const problems: string[] = [];
    try {
      if (files.length > 0) {
        const uploaded: TaskAttachment[] = [];
        for (const draft of files) {
          try {
            const result = await uploadTaskFile(newId, draft.file);
            if (result.ok) uploaded.push(result.attachment);
            else problems.push(`${draft.file.name}: ${result.error}`);
          } catch (error) {
            console.error("task-editor: upload failed", error);
            problems.push(`${draft.file.name}: ההעלאה נכשלה`);
          }
        }
        if (uploaded.length > 0) {
          const attached = await attachFilesToNewTask(newId, uploaded);
          if (!attached.ok) problems.push(attached.error);
        }
      }

      // A part typed but not yet added with "הוסף" still counts - Create is the obvious next click.
      const typed = partTitle.trim();
      const allParts = typed ? [...parts, { id: "typed", title: typed, assignee: partAssignee }] : parts;
      for (const part of allParts) {
        const sub = await createTask({
          title: part.title,
          priority,
          due_date: dueDate || null,
          assignee_id: part.assignee === "unassigned" ? null : part.assignee,
          parent_id: newId,
        });
        if (!sub.ok) problems.push(`תת-משימה "${part.title}": ${sub.error}`);
      }
    } catch (error) {
      console.error("task-editor: extras failed", error);
      problems.push("חלק מהקבצים או מתתי-המשימות לא נשמרו");
    }
    return problems;
  };

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
      let mail: TaskMailOutcome | undefined;
      // Files / sub-tasks of a NEW task that did not make it (the task itself did).
      let problems: string[] = [];
      if (task) {
        const result = await updateTask(task.id, {
          ...(canEdit("title") ? { title } : {}),
          ...(canEdit("description") ? { description: description || null } : {}),
          ...(canEdit("priority") ? { priority } : {}),
          ...(canEdit("assignee_id") ? { assignee_id: assigneeId } : {}),
          ...(canEdit("due_date") ? { due_date: dueDate || null } : {}),
          ...(canEdit("board") ? { board } : {}),
          ...(canEdit("phase") ? { phase: effectivePhase } : {}),
          ...(canEdit("channel") ? { channel: effectiveChannel } : {}),
          ...(canEdit("progress") ? { progress: effectiveProgress } : {}),
          ...(canEdit("reviewer_ids") ? { reviewer_ids: reviewerIds } : {}),
        });
        if (!result.ok) {
          toast({ variant: "destructive", title: "Save failed", description: result.error });
          return;
        }
        mail = result.mail;
      } else {
        const result = await createTask({
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
          reviewer_ids: reviewerIds,
        });
        if (!result.ok) {
          toast({ variant: "destructive", title: "Save failed", description: result.error });
          return;
        }
        mail = result.mail;
        problems = await saveExtras(result.id);
      }
      // Say what actually happened to the assignment mail, not what should have.
      const mailFailed = mail === "failed" || mail === "skipped";
      const mailNote =
        mail === "sent"
          ? "An email went out to the assignee."
          : mail === "failed"
            ? "Saved, but the email to the assignee FAILED - tell them directly."
            : mail === "skipped"
              ? "Saved, but the assignee has no email address on file."
              : undefined;
      toast({
        variant: mailFailed || problems.length > 0 ? "destructive" : undefined,
        title: task ? "Task updated" : "Task created",
        description:
          problems.length > 0
            ? [`המשימה נוצרה, אבל: ${problems.join(" · ")}`, mailNote].filter(Boolean).join(" ")
            : mailNote,
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={state.open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
        </DialogHeader>
        <div
          className="space-y-4"
          // A screenshot pasted anywhere in the New-task form becomes an attachment.
          onPaste={(event) => {
            if (task) return;
            const pasted = Array.from(event.clipboardData.files);
            if (pasted.length > 0) {
              event.preventDefault();
              addFiles(pasted);
            }
          }}
        >
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
          {/* Who reviews it: shown to everyone (it explains where the task goes back to), editable
              on a new task by anyone and on an existing one by admins (TASK_FIELDS). */}
          {(canEdit("reviewer_ids") || reviewerIds.length > 0) && (
            <div className="space-y-2">
              <Label>Reviewers</Label>
              {reviewerIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {reviewerIds.map((id) => (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-1 text-xs"
                    >
                      {reviewerName(id)}
                      {canEdit("reviewer_ids") && (
                        <button
                          type="button"
                          aria-label={`Remove reviewer ${reviewerName(id)}`}
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => setReviewerIds((prev) => prev.filter((item) => item !== id))}
                          disabled={saving}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
              {canEdit("reviewer_ids") && (
                <Select
                  value=""
                  onValueChange={(value) => setReviewerIds((prev) => (prev.includes(value) ? prev : [...prev, value]))}
                  disabled={saving || reviewerOptions.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="הוסף בודק…" />
                  </SelectTrigger>
                  <SelectContent>
                    {reviewerOptions
                      .filter((option) => !reviewerIds.includes(option.id))
                      .map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.display_name || option.email}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
              <p className="text-xs text-muted-foreground">
                {reviewerIds.length > 0
                  ? "When the task is moved to \"In review\" it goes back to these people (instead of whoever opened it), and they get an email."
                  : "Default: the task goes back to whoever opened it when it is moved to \"In review\". Pick someone else, or several, to review instead."}
              </p>
            </div>
          )}
          {/* An existing task attaches files in its thread (below) - a new one has no thread yet. */}
          {!task && (
            <div className="space-y-2">
              <Label>Attachments</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept={ATTACHMENT_ACCEPT}
                multiple
                className="hidden"
                onChange={(event) => {
                  addFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
              {files.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {files.map((draft) => (
                    <div key={draft.id} className="relative h-16 w-16 overflow-hidden rounded border">
                      {draft.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={draft.previewUrl} alt={draft.file.name} className="h-full w-full object-cover" />
                      ) : (
                        <div
                          title={draft.file.name}
                          className="flex h-full w-full flex-col items-center justify-center gap-0.5 bg-muted/40 px-1"
                        >
                          <FileText className="h-5 w-5 text-muted-foreground" />
                          <span dir="auto" className="w-full truncate text-center text-[9px] text-muted-foreground">
                            {draft.file.name}
                          </span>
                        </div>
                      )}
                      <button
                        type="button"
                        aria-label={`Remove ${draft.file.name}`}
                        className="absolute end-0 top-0 rounded-es bg-background/90 p-0.5 text-muted-foreground hover:text-foreground"
                        onClick={() => removeFile(draft.id)}
                        disabled={saving}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={saving || files.length >= MAX_ATTACHMENTS_PER_SEND}
                >
                  <Paperclip className="mr-1.5 h-4 w-4" />
                  Attach file
                </Button>
                <span className="text-xs text-muted-foreground">
                  Image or PDF, up to 2.5MB. A screenshot can be pasted with Ctrl+V.
                </span>
              </div>
            </div>
          )}
          {/* Same idea as the sub-tasks panel of an existing task (components/task-subtasks.tsx),
              only these are drafts: each is created under the new task right after it. */}
          {!task && (
            <div className="rounded-md border bg-muted/30 p-3" dir="rtl">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                  <ListTree className="h-4 w-4 text-muted-foreground" />
                  תתי-משימות
                </span>
                <span className="text-xs text-muted-foreground">כל חלק נפתח כמשימה משלו, מתחת למשימה הזו</span>
              </div>
              {parts.length > 0 && (
                <ul className="mb-3 space-y-1.5">
                  {parts.map((part) => (
                    <li key={part.id} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate" title={part.title}>
                        {part.title}
                      </span>
                      {isManager && (
                        <span
                          className={cn(
                            "shrink-0 text-xs",
                            part.assignee === "unassigned" ? "text-muted-foreground" : "text-foreground",
                          )}
                        >
                          {part.assignee === "unassigned"
                            ? "לא משויך"
                            : (staff.find((member) => member.id === part.assignee)?.display_name ??
                              staff.find((member) => member.id === part.assignee)?.email ??
                              "")}
                        </span>
                      )}
                      <button
                        type="button"
                        aria-label={`הסר את ${part.title}`}
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setParts((prev) => prev.filter((item) => item.id !== part.id))}
                        disabled={saving}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={partTitle}
                  onChange={(event) => setPartTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addPart();
                    }
                  }}
                  placeholder="חלק חדש במשימה…"
                  className="h-8 min-w-[160px] flex-1 text-sm"
                  disabled={saving}
                />
                {isManager && (
                  <Select value={partAssignee} onValueChange={setPartAssignee} disabled={saving}>
                    <SelectTrigger className="h-8 w-[150px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">לא משויך</SelectItem>
                      {staff.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.display_name || member.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={addPart}
                  disabled={saving || !partTitle.trim()}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span className="ms-1">הוסף</span>
                </Button>
              </div>
            </div>
          )}
          {prefill && (
            <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
              {prefill.origin}
            </p>
          )}
        </div>

        {/* No thread on a brand-new task - there is no task id to hang comments off yet. */}
        {task && children && <div className="mt-2">{children}</div>}
        {task && (
          <div className="mt-2 border-t pt-4">
            <TaskThread taskId={task.id} onRead={() => onThreadRead?.(task.id)} />
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
