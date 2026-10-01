"use client";

/**
 * Building blocks of the approvals screen (/tours/approvals): the frame of a
 * section, the heading of a list inside it, and the contract every row uses to
 * run its action.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonProps } from "@/components/ui/button";
import type { ActionResult } from "@/lib/tours/action-kit";

/**
 * Runs one action of the queue and reports it with the shared action toast.
 * `key` names the button that was pressed, so it alone shows the spinner while
 * every action button of the screen is disabled. Resolves true when the action
 * succeeded; the screen has reloaded by then.
 */
export type QueueRun = (
  key: string,
  action: () => Promise<ActionResult<unknown>>,
  okMessage?: string,
) => Promise<boolean>;

export interface QueueControls {
  run: QueueRun;
  /** The key of the action that is running, or null. */
  busy: string | null;
}

export const departureHref = (code: string, tab?: "prices" | "flights") =>
  `/tours/departures?code=${encodeURIComponent(code)}${tab ? `&tab=${tab}` : ""}`;
export const blockHref = (id: number) => `/offline-flights/${id}`;

export const linkClass =
  "font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";

export function CountBadge({ count, className }: { count: number; className?: string }) {
  return (
    <Badge variant={count > 0 ? "destructive" : "secondary"} className={cn("shrink-0 tabular-nums", className)}>
      {count.toLocaleString("en-US")}
    </Badge>
  );
}

/**
 * One section of the queue. With nothing to handle it folds into a single quiet
 * line, so the eye lands only on the sections that hold work.
 */
export function QueueSection({
  id,
  title,
  description,
  count,
  children,
}: {
  id: string;
  title: string;
  /** What puts a row here and what handling it means, in a sentence or two. */
  description: ReactNode;
  count: number;
  children: ReactNode;
}) {
  if (count === 0) {
    return (
      <section
        id={id}
        className="flex scroll-mt-20 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-dashed px-4 py-2.5 text-sm text-muted-foreground"
      >
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
        <h2 className="font-medium text-foreground/80">{title}</h2>
        <span>Nothing to handle</span>
      </section>
    );
  }
  return (
    <section id={id} className="scroll-mt-20 rounded-lg border bg-card shadow-sm">
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-2.5">
          <h2 className="font-display text-base font-semibold">{title}</h2>
          <CountBadge count={count} />
        </div>
        <p className="mt-1 max-w-[90ch] text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

/** A list inside a section: its own title, count and one line of explanation. */
export function SubList({
  title,
  count,
  hint,
  actions,
  emptyText,
  children,
}: {
  title: string;
  count: number;
  hint?: ReactNode;
  actions?: ReactNode;
  /** The quiet line shown instead of the list when it is empty. */
  emptyText: string;
  children: ReactNode;
}) {
  if (count === 0) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2.5 text-sm text-muted-foreground last:border-b-0">
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
        <h3 className="font-medium text-foreground/80">{title}</h3>
        <span>{emptyText}</span>
      </div>
    );
  }
  return (
    <div className="border-b last:border-b-0">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-4 pb-2 pt-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{title}</h3>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">
              {count.toLocaleString("en-US")}
            </span>
          </div>
          {hint && <p className="mt-0.5 max-w-[90ch] text-xs text-muted-foreground">{hint}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** A button of a queue row: disabled while any action runs, spinning when it is its own. */
export function ActionButton({
  actionKey,
  busy,
  children,
  disabled,
  ...props
}: Omit<ButtonProps, "type"> & { actionKey: string; busy: string | null }) {
  const running = busy === actionKey;
  return (
    <Button type="button" size="sm" {...props} disabled={disabled || busy !== null} aria-busy={running}>
      {running && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </Button>
  );
}

/** "Open the exact place where this is fixed" - the quiet second action of a row. */
export function OpenLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button asChild size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground">
      <Link href={href}>{children}</Link>
    </Button>
  );
}

/** "in 5 days" for a date that is today or later. */
export function inDays(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}
