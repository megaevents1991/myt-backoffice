"use client";

/**
 * Small pieces the departures board, the departure cards and the series screen
 * share: the sale status of a departure as a coloured pill - read-only on the
 * agent's card, a native <select> on the board and the staff card (the board
 * renders hundreds of rows, and a Radix select per cell is far heavier) - the
 * sticky header cell of their tables, the open-jaw mark of a route, and the
 * toast of a publish switch. The other building blocks of the tours screens
 * live in components/tours/ui.tsx.
 */
import { useCallback } from "react";
import { Shuffle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ROUTE_TYPE_LABELS } from "@/lib/tours/routes";
import { SALE_STATUSES, SALE_STATUS_LABELS, type SaleStatus } from "@/types/tours.types";
import { SALE_STATUS_STYLES } from "./departure-utils";
import type { BulkOutcome } from "./types";

/** A header cell that stays on top while a long table scrolls (the board, the series list). Add the padding. */
export const STICKY_TH =
  "sticky top-0 z-10 h-9 whitespace-nowrap bg-muted text-start text-xs font-semibold text-muted-foreground shadow-[inset_0_-1px_0_hsl(var(--border))]";

/** The small round mark next to a route that lands in one city and returns from another. */
export function OpenJawMark() {
  return (
    <span
      title={ROUTE_TYPE_LABELS.open_jaw}
      aria-label={ROUTE_TYPE_LABELS.open_jaw}
      className="ms-1 inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border border-info/30 bg-info-muted align-middle text-info"
    >
      <Shuffle className="h-3 w-3" />
    </span>
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

/**
 * The toast of one departure's publish switch (a board row or the card), from
 * the outcome of setDeparturesPublished: the reason it was refused, the
 * warning it went live with, or the plain result. `code` names the departure
 * in the titles (the board); without it they speak of "the departure" (the
 * card). Returns whether the change went through.
 */
export function usePublishToast() {
  const { toast } = useToast();
  return useCallback(
    (outcome: BulkOutcome, published: boolean, code?: string): boolean => {
      const skipped = outcome.skipped[0];
      if (skipped) {
        toast({ variant: "destructive", title: code ? `Can't publish ${code}` : "Can't publish", description: skipped.reason, duration: 7000 });
        return false;
      }
      const warning = outcome.warnings[0];
      if (warning) toast({ title: code ? `${code} published` : "Published", description: warning.reason, duration: 7000 });
      else toast({ title: `${code ?? "Departure"} ${published ? "published" : "unpublished"}` });
      return true;
    },
    [toast],
  );
}
