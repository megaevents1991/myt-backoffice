"use client";

/**
 * The two flight-block pieces the tours screens share: a block's status badge
 * and the days left to one of its deadlines. The generic building blocks (Ltr,
 * Section, Field, Notice, Stat) are in components/tours/ui.tsx, and numbers and
 * dates are formatted by lib/tours/format.ts.
 */
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { stageOf, stageLabel, type BlockStage } from "@/components/tours/flights/block-rules";

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

/** The status of a block, in its label and colour. */
export function BlockStatusBadge({ status, className }: { status: string | null; className?: string }) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", STAGE_TONE[stageOf(status)], className)}>
      {stageLabel(status)}
    </Badge>
  );
}

/** "In 12 days" / "Today" / "3 days overdue" - red once the date has passed. */
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
