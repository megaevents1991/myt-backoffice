"use client";

/**
 * "עמלה לתשלום" drill-down: what makes up the number, one line per open
 * order - the tile alone kept confusing everyone (240+40 read as "440?!").
 * Capped list, no inner scrolling; the full picture lives in ההזמנות שלי.
 */

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { PendingCommissionRow } from "@/lib/actions/portal-dashboard-actions";

const VISIBLE_ROWS = 6;

const usdExact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export function PendingCommissionList({ rows }: { rows: PendingCommissionRow[] }) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-6 items-center gap-1 text-xs font-medium text-primary transition-colors hover:opacity-80"
      >
        <ChevronLeft
          aria-hidden
          className={`h-3.5 w-3.5 transition-transform duration-200 ease-out ${
            open ? "-rotate-90" : ""
          }`}
        />
        {rows.length === 1 ? "הזמנה אחת פתוחה" : `${rows.length} הזמנות פתוחות`}
      </button>
      {open && (
        <ul className="animate-in fade-in duration-200 mt-2 space-y-1 border-t pt-2">
          {rows.slice(0, VISIBLE_ROWS).map((row) => (
            <li
              key={row.id}
              className="flex items-baseline justify-between gap-2 text-xs"
            >
              <span className="min-w-0 truncate text-muted-foreground">
                #{row.id}
                {row.event ? ` · ${row.event}` : ""}
              </span>
              <span className="shrink-0 font-medium tabular-nums">
                {usdExact.format(row.amountUsd)}
              </span>
            </li>
          ))}
          {rows.length > VISIBLE_ROWS && (
            <li className="text-xs text-muted-foreground">
              ועוד {rows.length - VISIBLE_ROWS}…
            </li>
          )}
          <li className="pt-1">
            <Link
              href="/portal/reservations"
              className="text-xs font-medium text-primary underline underline-offset-2 hover:opacity-80"
            >
              לכל ההזמנות ←
            </Link>
          </li>
        </ul>
      )}
    </div>
  );
}
