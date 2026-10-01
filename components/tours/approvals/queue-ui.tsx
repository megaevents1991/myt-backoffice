"use client";

/**
 * Building blocks of the approvals screen (/tours/approvals): the frame of a
 * section, the heading of a list inside it, and the contract every row uses to
 * run its action. Links to a departure or a block come from lib/tours/links.ts,
 * the count pill and the "nothing here" line from components/tours/ui.tsx.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2 } from "lucide-react";

import { Button, type ButtonProps } from "@/components/ui/button";
import type { ActionResult } from "@/lib/tours/action-kit";
import { CountBadge, EmptyLine } from "@/components/tours/ui";

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

/**
 * The quiet one line of a section or a list with nothing to handle: the shared
 * EmptyLine, led by a check mark and the title. The title keeps its heading
 * role (a real <h2>/<h3> may not sit inside EmptyLine's <p>).
 */
function NothingToHandle({ title, level, text }: { title: string; level: 2 | 3; text: string }) {
  return (
    <EmptyLine className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2.5 text-start">
      <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
      <span role="heading" aria-level={level} className="font-medium text-foreground/80">
        {title}
      </span>
      <span>{text}</span>
    </EmptyLine>
  );
}

/**
 * One section of the queue. With nothing to handle it folds into a single quiet
 * line, so the eye lands only on the sections that hold work - unless
 * `alwaysOpen`, for a summary whose zeros are the news themselves.
 */
export function QueueSection({
  id,
  title,
  description,
  count,
  actions,
  alwaysOpen = false,
  children,
}: {
  id: string;
  title: string;
  /** What puts a row here and what handling it means, in a sentence or two. */
  description: ReactNode;
  /** Rows waiting; null while still unknown (no badge, never folded). */
  count: number | null;
  /** Buttons on the end of the heading, e.g. a link to the full screen. */
  actions?: ReactNode;
  alwaysOpen?: boolean;
  children: ReactNode;
}) {
  if (count === 0 && !alwaysOpen) {
    return (
      <section id={id} className="scroll-mt-20">
        <NothingToHandle title={title} level={2} text="Nothing to handle" />
      </section>
    );
  }
  return (
    <section id={id} className="scroll-mt-20 rounded-lg border bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-base font-semibold">{title}</h2>
            {count !== null && <CountBadge count={count} />}
          </div>
          <p className="mt-1 max-w-[90ch] text-xs text-muted-foreground">{description}</p>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
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
      <div className="border-b px-4 py-3 last:border-b-0">
        <NothingToHandle title={title} level={3} text={emptyText} />
      </div>
    );
  }
  return (
    <div className="border-b last:border-b-0">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-4 pb-2 pt-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{title}</h3>
            <CountBadge count={count} />
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
