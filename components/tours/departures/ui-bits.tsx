"use client";

/**
 * Small building blocks shared by the departures board, the departure card and
 * the series screen. Native controls on purpose: the board renders hundreds of
 * rows, and a Radix switch or select per cell is far heavier than a <button>
 * or a <select>.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SALE_STATUSES, SALE_STATUS_LABELS, type SaleStatus } from "@/types/tours.types";
import { SALE_STATUS_STYLES } from "./departure-utils";

/** Codes, airports, flight numbers, prices and dates read left to right inside the Hebrew page. */
export function Ltr({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span dir="ltr" title={title} className={cn("inline-block [unicode-bidi:isolate]", className)}>
      {children}
    </span>
  );
}

/** On/off switch. Drawn left-to-right so the knob travels the same way in an RTL page. */
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
      dir="ltr"
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

export function SaleStatusBadge({ status, className }: { status: string; className?: string }) {
  const known = (SALE_STATUSES as readonly string[]).includes(status) ? (status as SaleStatus) : null;
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold",
        known ? SALE_STATUS_STYLES[known] : "bg-muted text-muted-foreground",
        className,
      )}
    >
      {known ? SALE_STATUS_LABELS[known] : status}
    </span>
  );
}

/** The sale status as a coloured pill that is also the control that changes it. */
export function SaleStatusSelect({
  value,
  onChange,
  disabled,
  className,
}: {
  value: string;
  onChange: (next: SaleStatus) => void;
  disabled?: boolean;
  className?: string;
}) {
  const known = (SALE_STATUSES as readonly string[]).includes(value) ? (value as SaleStatus) : null;
  return (
    <select
      aria-label="Sale status"
      value={value}
      disabled={disabled}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value as SaleStatus)}
      className={cn(
        "h-6 cursor-pointer appearance-none rounded-full border px-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
        known ? SALE_STATUS_STYLES[known] : "bg-muted text-muted-foreground",
        className,
      )}
    >
      {SALE_STATUSES.map((s) => (
        <option key={s} value={s} className="bg-background text-foreground">
          {SALE_STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

export const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export const inputClass = "h-9";

/** A labelled form field: small label above the control, optional hint below. */
export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block text-xs font-medium text-muted-foreground", className)}>
      <span className="mb-1 block">{label}</span>
      <div className="text-sm font-normal text-foreground">{children}</div>
      {hint && <span className="mt-1 block text-[11px] font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** Button row of a dialog. `gap` instead of the stock footer's space-x, which breaks in RTL. */
export function DialogActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center justify-end gap-2 pt-2", className)}>{children}</div>;
}

export function Chip({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A problem the operator has to read: red box with the reasons. */
export function Notice({
  tone = "warning",
  children,
  className,
}: {
  tone?: "warning" | "error" | "info" | "success";
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    warning: "border-warning/40 bg-warning-muted text-warning",
    error: "border-destructive/30 bg-destructive/10 text-destructive",
    info: "border-info/30 bg-info-muted text-info",
    success: "border-success/30 bg-success-muted text-success",
  } as const;
  return <div className={cn("rounded-md border px-3 py-2 text-sm", tones[tone], className)}>{children}</div>;
}
