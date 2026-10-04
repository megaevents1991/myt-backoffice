"use client";

/**
 * The dates of one tour as a tick list: which of them belong to a season, or
 * run an itinerary variant (Alon, 04.10.2026). Past dates are folded away.
 */
import { useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip, EmptyLine, Ltr } from "@/components/tours/ui";
import { fmtDateRange, nightsBetween, todayIso } from "@/lib/tours/format";
import type { BoardRow } from "@/components/tours/departures/types";

export function DatesChecklist({
  rows,
  value,
  onChange,
  noteOf,
  disabled = false,
}: {
  /** The tour's dates (not deleted). */
  rows: BoardRow[];
  /** The ids ticked. */
  value: Set<string>;
  onChange: (next: Set<string>) => void;
  /** What a row says next to its dates - e.g. the season it belongs to now. */
  noteOf?: (row: BoardRow) => ReactNode;
  disabled?: boolean;
}) {
  const today = useMemo(() => todayIso(), []);
  const [showPast, setShowPast] = useState(false);
  const live = useMemo(() => rows.filter((r) => !r.is_deleted), [rows]);
  const past = live.filter((r) => r.end_date < today);
  // a ticked past date stays in sight, so it is never changed unseen
  const shown = live.filter((r) => showPast || r.end_date >= today || value.has(r.id));

  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(value);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange(next);
  };

  if (live.length === 0) {
    return <EmptyLine>This tour has no dates yet. Dates come from a flight series, or from Add Date on the Dates &amp; Prices tab.</EmptyLine>;
  }
  const allTicked = shown.length > 0 && shown.every((r) => value.has(r.id));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1.5 font-medium">
          <Checkbox
            checked={allTicked}
            disabled={disabled || shown.length === 0}
            onCheckedChange={(v) => toggle(shown.map((r) => r.id), v === true)}
          />
          All dates shown
        </label>
        <span className="text-muted-foreground">
          {value.size} of {live.length} ticked
        </span>
        {past.length > 0 && (
          <Button type="button" size="sm" variant="ghost" className="ms-auto h-7 text-xs" onClick={() => setShowPast((v) => !v)}>
            {showPast ? "Hide past dates" : `Show past dates (${past.length})`}
          </Button>
        )}
      </div>
      <ul className="grid max-h-80 gap-1 overflow-auto rounded-md border p-2 sm:grid-cols-2">
        {shown.map((row) => (
          <li key={row.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted/60">
              <Checkbox checked={value.has(row.id)} disabled={disabled} onCheckedChange={(v) => toggle([row.id], v === true)} />
              <Ltr className="w-20 shrink-0 font-mono text-xs font-semibold">{row.code}</Ltr>
              <Ltr className="whitespace-nowrap tabular-nums">{fmtDateRange(row.start_date, row.end_date)}</Ltr>
              <span className="text-xs text-muted-foreground">{nightsBetween(row.start_date, row.end_date)}n</span>
              {row.is_published && <Chip tone="success">On site</Chip>}
              {noteOf && <span className="ms-auto truncate text-xs text-muted-foreground">{noteOf(row)}</span>}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
