"use client";

/**
 * The sale status of a departure as a coloured pill - read-only on the agent's
 * card, a native <select> on the board and the staff card (the board renders
 * hundreds of rows, and a Radix select per cell is far heavier). The other
 * building blocks of the tours screens live in components/tours/ui.tsx.
 */
import { cn } from "@/lib/utils";
import { SALE_STATUSES, SALE_STATUS_LABELS, type SaleStatus } from "@/types/tours.types";
import { SALE_STATUS_STYLES } from "./departure-utils";

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
