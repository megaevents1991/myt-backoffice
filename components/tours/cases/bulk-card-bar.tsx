"use client";

/**
 * The bulk bar of the Reservations board's card tables (Alon 10.11, "עריכה מרובה בבקשה"): the rows ticked get one
 * status, one follow-up day, or - a manager's move only (Dor 21.10) - one rep. One change at a time; the server
 * (`bulkUpdateCases`) holds every rule: the viewer's own cards for a rep, no Future / Deposit in bulk, a closing
 * status asks its reason once for the whole selection, a deposit card keeps its day.
 */
import { useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addDaysIso, bulkStatusBlocker, needsCloseReason, type CaseRep, type CaseStatus } from "@/lib/tours/cases";
import { todayIso } from "@/lib/tours/format";
import { BulkAssignSelect, CloseReasonDialog } from "@/components/tours/cases/case-ui";

export type BulkCardChange = { status?: string; closeReason?: string; assignedTo?: string | null; followUpDate?: string | null };

const QUICK_DAYS = [
  { label: "Today", days: 0 },
  { label: "Tomorrow", days: 1 },
  { label: "In 2 days", days: 2 },
  { label: "In a week", days: 7 },
] as const;

export function BulkCardBar({
  statuses,
  reps,
  manager,
  busy,
  count,
  onChange,
}: {
  statuses: readonly CaseStatus[];
  reps: readonly CaseRep[];
  /** Handing cards out is the manager's. */
  manager: boolean;
  busy: boolean;
  /** How many rows are ticked (the closing reason's dialog says it). */
  count: number;
  onChange: (change: BulkCardChange) => void;
}) {
  const [closing, setClosing] = useState<string | null>(null);
  const [dayOpen, setDayOpen] = useState(false);
  const today = todayIso();
  // a status that names a value of its own is set card by card - it is not offered here at all
  const offered = statuses.filter((s) => s.isActive && !bulkStatusBlocker(s.key, s.label));
  const pickDay = (day: string | null) => {
    setDayOpen(false);
    onChange({ followUpDate: day });
  };
  return (
    <>
      <Select disabled={busy} value="" onValueChange={(status) => (needsCloseReason(status, statuses) ? setClosing(status) : onChange({ status }))}>
        <SelectTrigger className="h-8 w-40 text-foreground" aria-label="Set status">
          <SelectValue placeholder="Set status…" />
        </SelectTrigger>
        <SelectContent>
          {offered.map((s) => (
            <SelectItem key={s.key} value={s.key}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Popover open={dayOpen} onOpenChange={setDayOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 text-foreground" disabled={busy}>
            <CalendarClock className="h-4 w-4" />
            Set follow-up…
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-3">
          <div className="flex flex-wrap gap-2">
            {QUICK_DAYS.map((q) => (
              <Button key={q.days} size="sm" variant="outline" onClick={() => pickDay(addDaysIso(today, q.days))}>
                {q.label}
              </Button>
            ))}
          </div>
          <label className="grid gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Another day</span>
            <Input
              type="date"
              dir="ltr"
              min={today}
              onChange={(e) => {
                const day = e.target.value;
                if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day >= today) pickDay(day);
              }}
            />
          </label>
          <Button size="sm" variant="ghost" onClick={() => pickDay(null)}>
            Clear the day
          </Button>
        </PopoverContent>
      </Popover>
      {manager && <BulkAssignSelect reps={reps} disabled={busy} onAssign={(id) => onChange({ assignedTo: id })} />}
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      <CloseReasonDialog
        status={closing}
        statuses={statuses}
        count={count}
        onCancel={() => setClosing(null)}
        onConfirm={(closeReason) => {
          const status = closing;
          setClosing(null);
          if (status) onChange({ status, closeReason });
        }}
      />
    </>
  );
}
