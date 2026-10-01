"use client";

/**
 * Small building blocks shared by the flight-operations screens of a tours
 * company (block panel, contracts, calendar, rates, reports, data problems).
 * Everything here is right-to-left Hebrew; codes, numbers and dates are wrapped
 * in <Ltr> so they keep their reading order.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { stageOf, stageLabel, type BlockStage } from "@/components/tours/flights/block-rules";

/** The answer shape of every tours server action. */
export type ActionAnswer = { success: true; warning?: string } | { success: false; error: string };

/**
 * Runs a mutation and reports it: true when it succeeded. `okMessage` is toasted
 * on success; the action's own error or warning text is toasted as it is.
 */
export type RunAction = (action: () => Promise<ActionAnswer>, okMessage?: string) => Promise<boolean>;

/** Codes, airports, flight numbers, prices and dates read left to right inside Hebrew text. */
export function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span dir="ltr" className={cn("inline-block tabular-nums", className)}>
      {children}
    </span>
  );
}

/** One titled card of a screen. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg border bg-card p-4 shadow-sm", className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** A label above a form control. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A number with its caption - the seat and cost summaries. */
export function Stat({
  label,
  value,
  tone = "default",
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "danger" | "muted";
  hint?: ReactNode;
}) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-xl font-semibold tabular-nums",
          tone === "danger" && "text-destructive",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

// Kept under their old names: the stock dialog parts, scrollable, with the primary action (the first
// child of the footer) on the right.
export function RtlDialogContent({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <DialogContent className={cn("max-h-[90vh] overflow-y-auto", className)}>
      {children}
    </DialogContent>
  );
}

export function RtlDialogHeader({ children }: { children: ReactNode }) {
  return <DialogHeader>{children}</DialogHeader>;
}

export function RtlDialogFooter({ children }: { children: ReactNode }) {
  return <DialogFooter className="gap-2 sm:flex-row-reverse sm:justify-start sm:space-x-0">{children}</DialogFooter>;
}

const STAGE_TONE: Record<BlockStage, string> = {
  draft: "border-dashed bg-background text-muted-foreground",
  approved: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200",
  requested: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  option: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  declined: "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
  confirmed: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  operational: "border-emerald-400 bg-emerald-100 text-emerald-950 dark:border-emerald-700 dark:bg-emerald-900 dark:text-emerald-100",
  ticketed: "border-emerald-400 bg-emerald-100 text-emerald-950 dark:border-emerald-700 dark:bg-emerald-900 dark:text-emerald-100",
  cancelled: "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
};

/** The status of a block, in its Hebrew wording and colour. */
export function BlockStatusBadge({ status, className }: { status: string | null; className?: string }) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", STAGE_TONE[stageOf(status)], className)}>
      {stageLabel(status)}
    </Badge>
  );
}

/** "בעוד 12 ימים" / "היום" / "באיחור של 3 ימים" - red once the date has passed. */
export function DaysLeft({ days, done = false }: { days: number | null; done?: boolean }) {
  if (days === null) return <span className="text-xs text-muted-foreground">Not set</span>;
  if (done) return <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Done</span>;
  if (days < 0) {
    return (
      <span className="text-xs font-semibold text-destructive">
        {days === -1 ? "1 day overdue" : `${-days} days overdue`}
      </span>
    );
  }
  if (days === 0) return <span className="text-xs font-semibold text-destructive">Today</span>;
  return (
    <span className={cn("text-xs", days <= 7 ? "font-semibold text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
      {days === 1 ? "Tomorrow" : `In ${days} days`}
    </span>
  );
}

const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** "1,234.5" - plain number, no currency sign. */
export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "" : NUMBER.format(value);
}

/** "1,234.5 USD", or a dash when there is no amount. */
export function formatMoney(value: number | null | undefined, currency: string | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return currency ? `${NUMBER.format(value)} ${currency}` : NUMBER.format(value);
}

/** A typed number field: "" -> null, a number -> itself, anything else -> undefined (invalid). */
export function parseNumber(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

/** `HH:MM` of a timestamp as written (no timezone conversion). */
export function timeOf(timestamp: string | null | undefined): string {
  return timestamp && timestamp.length >= 16 ? timestamp.slice(11, 16) : "";
}

/** The inline message of a failed or empty load. */
export function Notice({ tone = "muted", children }: { tone?: "muted" | "danger" | "warning"; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        tone === "muted" && "border-dashed text-muted-foreground",
        tone === "danger" && "border-destructive/40 bg-destructive/5 text-destructive",
        tone === "warning" &&
          "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
      )}
    >
      {children}
    </div>
  );
}
