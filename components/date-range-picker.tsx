"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface DatePreset {
  id: string;
  label: string;
}

/** yyyy-mm-dd <-> a local Date at midnight (the calendar works in local days; no time zone enters). */
const toDate = (s: string | undefined): Date | undefined => {
  if (!s) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const toDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const show = (s: string) => s.split("-").reverse().join("/");

/**
 * A period picker: presets on the side, a two-month range calendar beside them. Generic - it knows days, not what
 * they are for. `preset` = the active preset id, or "custom" when `from`/`to` were picked on the calendar.
 */
export function DateRangePicker({
  presets,
  preset,
  from,
  to,
  maxDay,
  onPreset,
  onRange,
  className,
}: {
  presets: DatePreset[];
  preset: string;
  /** The window shown (yyyy-mm-dd) - also what the calendar opens on. */
  from: string;
  to: string;
  /** Last pickable day (yyyy-mm-dd). */
  maxDay?: string;
  onPreset: (id: string) => void;
  onRange: (from: string, to: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();
  const max = toDate(maxDay);
  const label = presets.find((p) => p.id === preset)?.label ?? `${show(from)} – ${show(to)}`;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft({ from: toDate(from), to: toDate(to) });
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn("h-9 justify-start gap-2 font-normal", className)} aria-label="Date range">
          <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span>{label}</span>
          {preset !== "custom" && (
            <span dir="ltr" className="hidden text-xs text-muted-foreground sm:inline">
              {show(from)} – {show(to)}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <div className="flex flex-col sm:flex-row">
          <div className="flex flex-row flex-wrap gap-1 border-b p-2 sm:w-36 sm:flex-col sm:border-b-0 sm:border-e">
            {presets.map((p) => (
              <Button
                key={p.id}
                variant={p.id === preset ? "secondary" : "ghost"}
                size="sm"
                className="justify-start"
                onClick={() => {
                  onPreset(p.id);
                  setOpen(false);
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div>
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={draft}
              onSelect={setDraft}
              defaultMonth={toDate(from)}
              disabled={max ? { after: max } : undefined}
              weekStartsOn={0}
            />
            <div className="flex items-center justify-end gap-2 border-t p-2">
              <span dir="ltr" className="me-auto text-xs text-muted-foreground">
                {draft?.from ? show(toDay(draft.from)) : "—"} – {draft?.to ? show(toDay(draft.to)) : "—"}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!draft?.from || !draft?.to}
                onClick={() => {
                  if (!draft?.from || !draft?.to) return;
                  onRange(toDay(draft.from), toDay(draft.to));
                  setOpen(false);
                }}
              >
                Apply
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
