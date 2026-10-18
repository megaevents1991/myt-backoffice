"use client";

/**
 * The small pieces the Reservations table and the case page share: the status
 * tag, the TYPE and TASK badges, and the status / rep pickers.
 */
import { useState, type MouseEvent, type ReactNode } from "react";
import { ChevronDown, ExternalLink, MessageCircle, Pencil } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isFollowUpDate } from "@/lib/reservations/follow-up";
import {
  BOOKING_PHASE_LABELS,
  CASE_TASK_LABELS,
  CASE_TYPE_LABELS,
  CLOSE_REASON_MAX,
  CLOSE_REASON_MIN,
  CLOSE_REASON_PRESETS,
  STATUS_COLOR_CLASSES,
  checkCloseReason,
  needsCloseReason,
  statusOf,
  waLink,
  whatsappAppLink,
  type BookingPhase,
  type CaseRep,
  type CaseStatus,
  type CaseTask,
  type CaseType,
} from "@/lib/tours/cases";

/** Value of the rep picker for "nobody". */
export const NOBODY = "nobody";

/**
 * A control inside a clickable table row. Radix menus render in a portal but
 * React still bubbles their clicks up to the row - this stops them here, so
 * picking a status never opens the case.
 */
export function InRow({ children, className }: { children: ReactNode; className?: string }) {
  const stop = (event: MouseEvent) => event.stopPropagation();
  return (
    <div className={className} onClick={stop}>
      {children}
    </div>
  );
}

export function StatusTag({ status, statuses, className }: { status: string; statuses: readonly CaseStatus[]; className?: string }) {
  const found = statusOf(status, statuses);
  return (
    <span
      dir="auto"
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold",
        STATUS_COLOR_CLASSES[found?.color ?? "gray"],
        className,
      )}
    >
      {found?.label ?? status}
    </span>
  );
}

/**
 * TYPE is the first thing a rep reads on a row (Alon 18.10: "start with TYPE and TASK"), so each type owns a
 * hue: booked = green, a lead = blue, a future interest = violet with a dashed edge (nothing to sell yet).
 * The word is always printed - the colour only speeds the eye.
 */
export const TYPE_CLASSES: Record<CaseType, string> = {
  reservation: "border-green-600/30 bg-green-500/10 text-green-800 dark:text-green-300",
  lead: "border-blue-600/30 bg-blue-500/10 text-blue-800 dark:text-blue-300",
  potential: "border-dashed border-violet-500/50 bg-violet-500/5 text-violet-800 dark:text-violet-300",
};
/** The wash a case's header takes from its type (the case page). */
export const TYPE_WASH: Record<CaseType, string> = {
  reservation: "border-green-600/25 bg-[linear-gradient(rgb(34_197_94/0.07),rgb(34_197_94/0.02))]",
  lead: "border-blue-600/25 bg-[linear-gradient(rgb(59_130_246/0.07),rgb(59_130_246/0.02))]",
  potential: "border-violet-500/25 bg-[linear-gradient(rgb(139_92_246/0.07),rgb(139_92_246/0.02))]",
};

export function TypeBadge({ type }: { type: CaseType }) {
  return (
    <span className={cn("inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold", TYPE_CLASSES[type])}>
      {CASE_TYPE_LABELS[type]}
    </span>
  );
}

export function TaskBadge({ task, overridden }: { task: CaseTask | null; overridden?: boolean }) {
  if (!task) return <span className="text-muted-foreground">-</span>;
  return (
    <span
      dir="rtl"
      title={overridden ? "Set by hand" : "Automatic - follows the case"}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300"
    >
      {CASE_TASK_LABELS[task]}
      {overridden && <Pencil className="h-3 w-3" aria-label="set by hand" />}
    </span>
  );
}

/**
 * The company's active statuses, plus the case's own one when it was switched off since. A status
 * that closes the case without a deal (Not relevant, Cancelled, ...) first asks why - the change is
 * saved only with a reason (Alon 15.10); cancelling the question keeps the old status.
 */
export function StatusSelect({
  value,
  statuses,
  disabled,
  onChange,
  className,
  title,
}: {
  value: string;
  statuses: readonly CaseStatus[];
  disabled?: boolean;
  onChange: (status: string, closeReason?: string) => void;
  className?: string;
  /** Hover text - the close reason of a closed case. */
  title?: string;
}) {
  const [asking, setAsking] = useState<string | null>(null);
  const offered = statuses.filter((s) => s.isActive || s.key === value);
  return (
    <>
      <Select value={value} disabled={disabled} onValueChange={(next) => (needsCloseReason(next, statuses) ? setAsking(next) : onChange(next))}>
        <SelectTrigger aria-label="Status" title={title} className={cn("h-8 w-auto min-w-[8rem] gap-1 border-none bg-transparent px-1 shadow-none", className)}>
          <SelectValue>
            <StatusTag status={value} statuses={statuses} />
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {offered.map((s) => (
            <SelectItem key={s.key} value={s.key}>
              <StatusTag status={s.key} statuses={statuses} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <CloseReasonDialog
        status={asking}
        statuses={statuses}
        onCancel={() => setAsking(null)}
        onConfirm={(reason) => {
          if (asking) onChange(asking, reason);
          setAsking(null);
        }}
      />
    </>
  );
}

/**
 * "Why is it closed?" - one click on a common reason or the rep's own words; Save stays off until
 * there is a reason (CLOSE_REASON_MIN). `status` null = closed. Used by one case and by the bulk bar.
 */
export function CloseReasonDialog({
  status,
  statuses,
  count,
  onCancel,
  onConfirm,
}: {
  status: string | null;
  statuses: readonly CaseStatus[];
  /** Several cases at once (the bulk bar). */
  count?: number;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const checked = checkCloseReason(reason);
  const label = status ? (statusOf(status, statuses)?.label ?? status) : "";
  const close = () => {
    setReason("");
    onCancel();
  };
  return (
    <Dialog open={status !== null} onOpenChange={(open) => !open && close()}>
      {/* inside a clickable table row: a click in the dialog must not open the case */}
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>
            Why {count && count > 1 ? `are ${count} cases` : "is the case"} <span dir="auto">&quot;{label}&quot;</span>?
          </DialogTitle>
          <DialogDescription>The reason is saved on the case and shows in the table - the team learns why customers drop.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2" dir="rtl">
          {CLOSE_REASON_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setReason(preset)}
              aria-pressed={reason === preset}
              className={cn(
                "min-h-9 rounded-full border px-3 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                reason === preset && "border-primary bg-primary/10 text-primary",
              )}
            >
              {preset}
            </button>
          ))}
        </div>
        <div className="grid gap-1">
          <label htmlFor="close-reason" className="text-sm font-medium">
            Reason <span className="text-destructive">*</span>
          </label>
          <Textarea
            id="close-reason"
            dir="auto"
            rows={3}
            maxLength={CLOSE_REASON_MAX}
            value={reason}
            autoFocus
            onChange={(e) => setReason(e.target.value)}
            placeholder="What happened - in a few words"
            aria-invalid={reason.length > 0 && !checked.ok}
          />
          <p className="text-xs text-muted-foreground">Required - at least {CLOSE_REASON_MIN} characters.</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Keep the status
          </Button>
          <Button
            disabled={!checked.ok}
            onClick={() => {
              if (!checked.ok) return;
              setReason("");
              onConfirm(checked.reason);
            }}
          >
            Save with reason
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * WhatsApp to the customer from the rep's OWN app: whatsapp:// opens WhatsApp Desktop (or the phone's
 * app) on the chat, no browser tab (Alon 15.10). The menu keeps WhatsApp Web for a computer without
 * the app. Nothing when the phone cannot be a WhatsApp number.
 */
export function WhatsAppButton({ phone, message, iconOnly }: { phone: string | null; message: string; iconOnly?: boolean }) {
  const app = whatsappAppLink(phone, message);
  const web = waLink(phone, message);
  if (!app || !web) return null;
  if (iconOnly) {
    return (
      <Button variant="ghost" size="icon" className="h-8 w-8 text-success hover:text-success" asChild>
        <a href={app} aria-label="WhatsApp - opens the WhatsApp app" title="Opens WhatsApp on this computer">
          <MessageCircle className="h-4 w-4" />
        </a>
      </Button>
    );
  }
  return (
    <div className="inline-flex items-center">
      <Button variant="outline" size="sm" className="rounded-e-none" asChild>
        <a href={app} title="Opens WhatsApp on this computer">
          <MessageCircle className="h-4 w-4" />
          WhatsApp
        </a>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="rounded-s-none border-s-0 px-1.5" aria-label="More WhatsApp options">
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <a href={web} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              Open in WhatsApp Web
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const PHASE_CLASSES: Record<BookingPhase, string> = {
  active: "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300",
  past: "border-border bg-muted text-muted-foreground",
  cancelled: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
};

/** Active / Past / Cancelled - where one of the customer's orders stands. */
export function PhaseTag({ phase }: { phase: BookingPhase }) {
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold", PHASE_CLASSES[phase])}>
      {BOOKING_PHASE_LABELS[phase]}
    </span>
  );
}

/**
 * A field inside a table row reads as plain text until the pointer or the keyboard reaches
 * it - fourteen bordered boxes per row made the table look like a form.
 */
export const GHOST_FIELD =
  "border-transparent bg-transparent shadow-none hover:border-input focus-visible:border-input focus-visible:bg-background data-[state=open]:border-input";

export function RepSelect({
  value,
  reps,
  currentUserId,
  disabled,
  onChange,
  className,
  ghost,
}: {
  value: string | null;
  reps: readonly CaseRep[];
  currentUserId: string;
  disabled?: boolean;
  onChange: (rep: string | null) => void;
  className?: string;
  /** In a table row: no box until hovered or focused. */
  ghost?: boolean;
}) {
  const name = value ? (reps.find((p) => p.id === value)?.name ?? "Another teammate") : "";
  return (
    <Select value={value ?? NOBODY} disabled={disabled} onValueChange={(id) => onChange(id === NOBODY ? null : id)}>
      <SelectTrigger aria-label="Rep" className={cn("h-8 w-auto min-w-[8rem] gap-1", ghost && cn(GHOST_FIELD, "px-2"), className)}>
        <SelectValue>
          <span dir="auto" className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? name : "Unassigned"}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NOBODY}>Unassigned</SelectItem>
        {reps.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
            {p.id === currentUserId ? " (me)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The follow-up day, edited in place. Uncontrolled like the Mega Events
 * reservations' box: a picked or fully typed day saves at once, an emptied box
 * saves on blur - a controlled box saved every half-typed day (a year typed digit
 * by digit read as "0002-10-14"), so a day from before 2000 never saves.
 */
export function FollowUpInput({
  value,
  due,
  onSave,
  className,
  ghost,
}: {
  value: string | null;
  due: boolean;
  onSave: (next: string | null) => void;
  className?: string;
  /** In a table row: no box, and an empty day hides the browser's "dd/mm/yyyy" until hovered. */
  ghost?: boolean;
}) {
  return (
    <input
      // remount when the stored day changes elsewhere (a bulk change, a failed save)
      key={value ?? "none"}
      type="date"
      dir="ltr"
      aria-label="Follow-up day"
      title={due ? "The follow-up day has come" : "The day to get back to the customer"}
      defaultValue={value ?? ""}
      onChange={(e) => {
        const next = e.target.value;
        if (isFollowUpDate(next) && next >= "2000-01-01" && next !== value) onSave(next);
      }}
      onBlur={(e) => {
        if (e.target.value === "" && value) onSave(null);
      }}
      className={cn(
        "h-8 w-36 rounded-md border border-input bg-background px-2 text-sm tabular text-foreground",
        due && "border-destructive font-semibold text-destructive",
        ghost && GHOST_FIELD,
        ghost && !value && "text-transparent hover:text-muted-foreground focus:text-foreground",
        className,
      )}
    />
  );
}
