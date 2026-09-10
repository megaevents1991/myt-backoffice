"use client";

import { useEffect, useState } from "react";

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
import { STAFF_ROLES, type UserProfile } from "@/types/auth.types";
import {
  TASK_PRIORITIES,
  type TaskPriority,
  type TaskSource,
  type TaskSourceRef,
  type TaskWithNames,
} from "@/types/task.types";

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
}

/**
 * The one task dialog: create (blank or prefilled from a source) and edit.
 * Loads the staff list itself when the viewer is a manager (listUsers is
 * admin-guarded), so any screen can open it without wiring users through.
 */
export function TaskEditor({
  state,
  isManager,
  onClose,
  onSaved,
}: {
  state: TaskEditorState;
  isManager: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const { task, prefill } = state;

  const [title, setTitle] = useState(task?.title ?? prefill?.title ?? "");
  const [description, setDescription] = useState(
    task?.description ?? prefill?.description ?? "",
  );
  const [priority, setPriority] = useState<TaskPriority>(
    task?.priority ?? prefill?.priority ?? "medium",
  );
  const [assignee, setAssignee] = useState<string>(task?.assignee_id ?? "unassigned");
  const [dueDate, setDueDate] = useState(task?.due_date ?? "");
  const [saving, setSaving] = useState(false);
  const [staff, setStaff] = useState<UserProfile[]>([]);

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
            source: prefill?.source ?? "manual",
            source_ref: prefill?.source_ref ?? null,
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
