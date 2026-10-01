"use client";
// components/task-remind-button.tsx
// "Send a reminder" on one task (Dor, 01.10) - the table row and the task dialog. Asks once,
// says whom it mails; the server (remindTask) decides who may and holds a second press back.

import { useState } from "react";
import { BellRing } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { remindTask } from "@/lib/actions/task-actions";
import { canRemind, reminderCoolingDown } from "@/lib/tasks/reminders";
import type { TaskWithNames } from "@/types/task.types";

/** Who the reminder will reach, in words - the same rule as reminderTargets, by name. */
function targetLabel(task: TaskWithNames): string {
  if (task.status === "review") {
    if (task.reviewer_names.length > 0) return task.reviewer_names.join(", ");
    return task.created_by_name ?? "הבודק";
  }
  return task.assignee_name ?? "האחראי";
}

function since(iso: string): string {
  const minutes = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `לפני ${minutes} דק׳`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `לפני ${hours} שע׳`;
  const days = Math.round(hours / 24);
  return days === 1 ? "אתמול" : `לפני ${days} ימים`;
}

export function TaskRemindButton({
  task,
  onSent,
  className,
  withLabel = false,
}: {
  task: TaskWithNames;
  onSent?: () => void;
  className?: string;
  /** The dialog shows the word too; the table row is the icon alone. */
  withLabel?: boolean;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);

  if (!user || !canRemind(user.role, task, user.id)) return null;
  const cooling = reminderCoolingDown(task.last_reminded_at, new Date());
  const who = targetLabel(task);

  const send = async () => {
    setSending(true);
    try {
      const result = await remindTask(task.id);
      if (!result.ok) {
        toast({ variant: "destructive", title: "התזכורת לא נשלחה", description: result.error });
        return;
      }
      toast({
        variant: result.mail === "sent" ? undefined : "destructive",
        title: result.mail === "sent" ? "התזכורת נשלחה" : "התזכורת לא נשלחה",
        description:
          result.mail === "sent"
            ? `נשלח מייל ל-${result.reached.join(", ")}. התזכורת נרשמה בשיחה על המשימה.`
            : result.mail === "skipped"
              ? "לנמען אין כתובת מייל פעילה - תעדכן אותו ישירות."
              : "שליחת המייל נכשלה - תעדכן אותו ישירות.",
      });
      setOpen(false);
      onSent?.();
    } finally {
      setSending(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={withLabel ? "sm" : "icon"}
          className={cn(withLabel ? "h-8 gap-1.5" : "h-8 w-8", task.late && "text-destructive", className)}
          aria-label="שלח תזכורת"
          title={
            task.last_reminded_at
              ? `תזכורת נשלחה ${since(task.last_reminded_at)}`
              : `שלח תזכורת במייל ל-${who}`
          }
          // The row is clickable (it opens the thread) - this button is not part of that.
          onClick={(event) => event.stopPropagation()}
        >
          <BellRing className="h-4 w-4" />
          {withLabel && "תזכורת"}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 space-y-3 text-sm"
        dir="rtl"
        onClick={(event) => event.stopPropagation()}
      >
        <p>
          לשלוח ל-<span className="font-semibold">{who}</span> מייל תזכורת על המשימה?
        </p>
        <p className="text-xs text-muted-foreground">
          {task.status === "review"
            ? "המשימה מחכה לבדיקה שלהם - המייל יבקש לאשר או להחזיר לעבודה."
            : "המייל אומר שהמשימה עדיין פתוחה ומבקש לעדכן אותה או לכתוב מה תקוע."}
          {task.last_reminded_at && ` תזכורת קודמת: ${since(task.last_reminded_at)}.`}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={sending}>
            ביטול
          </Button>
          <Button size="sm" onClick={send} disabled={sending || cooling}>
            {cooling ? "נשלחה בשעה האחרונה" : sending ? "שולח…" : "שלח תזכורת"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
