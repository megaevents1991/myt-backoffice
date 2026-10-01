"use client";

/**
 * The flight-block pieces the tours screens share: a block's status badge and
 * the days left to a date. The generic building blocks (Ltr, Section, Field,
 * Notice, Chip, Stat) are in components/tours/ui.tsx, and numbers and dates are
 * formatted by lib/tours/format.ts.
 */
import { cn } from "@/lib/utils";
import { Chip, type ChipTone } from "@/components/tours/ui";
import { stageOf, stageLabel, type BlockStage } from "@/components/tours/flights/block-rules";

/** A stage in the shared Chip palette: waiting = muted, on its way = info / warning, live = success. */
const STAGE_TONE: Record<BlockStage, ChipTone> = {
  draft: "muted",
  approved: "info",
  requested: "warning",
  option: "warning",
  declined: "muted",
  confirmed: "success",
  operational: "success",
  ticketed: "success",
  cancelled: "error",
};

/** The status of a block, in its label and colour - the same chip on every screen that shows it. */
export function BlockStatusBadge({ status, className }: { status: string | null; className?: string }) {
  return (
    <Chip tone={STAGE_TONE[stageOf(status)]} className={className}>
      {stageLabel(status)}
    </Chip>
  );
}

/**
 * "In 12 days" / "Tomorrow" / "Today" / "3 days overdue" - the one wording of a
 * date's distance from today, for DaysLeft and for any line that says it in text.
 */
export function daysLeftText(days: number): string {
  if (days < 0) return days === -1 ? "1 day overdue" : `${-days} days overdue`;
  if (days === 0) return "Today";
  return days === 1 ? "Tomorrow" : `In ${days} days`;
}

/** The days left to a deadline (daysLeftText) - red once it is today or past, amber within a week. */
export function DaysLeft({ days, done = false }: { days: number | null; done?: boolean }) {
  if (days === null) return <span className="text-xs text-muted-foreground">Not set</span>;
  if (done) return <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Done</span>;
  return (
    <span
      className={cn(
        "text-xs",
        days <= 0
          ? "font-semibold text-destructive"
          : days <= 7
            ? "font-semibold text-amber-700 dark:text-amber-400"
            : "text-muted-foreground",
      )}
    >
      {daysLeftText(days)}
    </span>
  );
}
