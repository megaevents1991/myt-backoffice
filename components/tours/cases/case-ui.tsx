"use client";

/**
 * The small pieces the Reservations table and the case page share: the status
 * tag, the TYPE and TASK badges, and the status / rep pickers.
 */
import type { MouseEvent, ReactNode } from "react";
import { Pencil } from "lucide-react";

import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CASE_TASK_LABELS,
  CASE_TYPE_LABELS,
  STATUS_COLOR_CLASSES,
  statusOf,
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

const TYPE_CLASSES: Record<CaseType, string> = {
  reservation: "border-transparent bg-primary text-primary-foreground",
  lead: "border-transparent bg-secondary text-secondary-foreground",
  potential: "border-dashed text-muted-foreground",
};

export function TypeBadge({ type }: { type: CaseType }) {
  return (
    <span className={cn("inline-flex whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium", TYPE_CLASSES[type])}>
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

/** The company's active statuses, plus the case's own one when it was switched off since. */
export function StatusSelect({
  value,
  statuses,
  disabled,
  onChange,
  className,
}: {
  value: string;
  statuses: readonly CaseStatus[];
  disabled?: boolean;
  onChange: (status: string) => void;
  className?: string;
}) {
  const offered = statuses.filter((s) => s.isActive || s.key === value);
  return (
    <Select value={value} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger aria-label="Status" className={cn("h-8 w-auto min-w-[8rem] gap-1 border-none bg-transparent px-1 shadow-none", className)}>
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
  );
}

export function RepSelect({
  value,
  reps,
  currentUserId,
  disabled,
  onChange,
  className,
}: {
  value: string | null;
  reps: readonly CaseRep[];
  currentUserId: string;
  disabled?: boolean;
  onChange: (rep: string | null) => void;
  className?: string;
}) {
  const name = value ? (reps.find((p) => p.id === value)?.name ?? "Another teammate") : "";
  return (
    <Select value={value ?? NOBODY} disabled={disabled} onValueChange={(id) => onChange(id === NOBODY ? null : id)}>
      <SelectTrigger aria-label="Rep" className={cn("h-8 w-auto min-w-[8rem] gap-1", className)}>
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
