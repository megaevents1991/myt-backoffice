"use client";

/**
 * The small building blocks every tours screen shares: a form field, a section
 * card, an inline notice, a chip, a figure, an on/off toggle. One copy each, in
 * the look of the shadcn forms the Mega Events screens use.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

/** Codes, numbers, prices and dates: one line, tabular figures. */
export function Ltr({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span dir="ltr" title={title} className={cn("inline-block tabular-nums [unicode-bidi:isolate]", className)}>
      {children}
    </span>
  );
}

/**
 * Label + control + hint. With `htmlFor` the label points at the control;
 * without it the whole field is a <label>, so the control inside still gets
 * the label as its accessible name.
 */
export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  const hintNode = hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null;
  if (htmlFor) {
    return (
      <div className={cn("grid gap-1.5", className)}>
        <Label htmlFor={htmlFor}>{label}</Label>
        {children}
        {hintNode}
      </div>
    );
  }
  return (
    <label className={cn("grid gap-1.5", className)}>
      <span className="text-sm font-medium leading-none">{label}</span>
      <div className="text-sm">{children}</div>
      {hintNode}
    </label>
  );
}

/** One titled card of a screen or an editor tab. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-4 rounded-lg border bg-card p-4", className)}>
      {(title || description || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {title && <h2 className="font-display text-base font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export type NoticeTone = "muted" | "info" | "warning" | "error" | "success";

const NOTICE_TONES: Record<NoticeTone, string> = {
  muted: "border-dashed text-muted-foreground",
  info: "border-info/30 bg-info-muted text-info",
  warning: "border-warning/40 bg-warning-muted text-warning",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  success: "border-success/30 bg-success-muted text-success",
};

/** A line the operator has to read: a failed load, a warning, a hint. */
export function Notice({
  tone = "warning",
  children,
  className,
}: {
  tone?: NoticeTone;
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("rounded-md border px-3 py-2 text-sm", NOTICE_TONES[tone], className)}>{children}</div>;
}

export type ChipTone = "muted" | "outline" | "danger";

/** A small inline pill (a <span>, so it may sit inside text). */
export function Chip({
  tone = "muted",
  children,
  className,
  title,
}: {
  tone?: ChipTone;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tone === "muted" && "bg-muted text-muted-foreground",
        tone === "outline" && "text-foreground",
        tone === "danger" && "border-transparent bg-destructive text-destructive-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A figure with its caption - seat and cost summaries inside a card. */
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

/**
 * On/off switch for the departures board, where hundreds of rows make a Radix
 * Switch per cell too heavy. Everywhere else use components/ui/switch.
 */
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
  size = "md",
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
  size?: "sm" | "md";
}) {
  const small = size === "sm";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50",
        small ? "h-[18px] w-8" : "h-5 w-9",
        checked ? "bg-success" : "bg-input",
      )}
    >
      <span
        className={cn(
          "pointer-events-none block rounded-full bg-background shadow transition-transform",
          small ? "h-3.5 w-3.5" : "h-4 w-4",
          checked ? (small ? "translate-x-[15px]" : "translate-x-[18px]") : "translate-x-0.5",
        )}
      />
    </button>
  );
}

/** The native <select> look of the tours filters. */
export const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
