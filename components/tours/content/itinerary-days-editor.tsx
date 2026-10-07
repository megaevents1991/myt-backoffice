"use client";

/**
 * The days of one itinerary: open a day to edit its route, subtitle, picture
 * and text; reorder (drag the grip, or the arrows), remove, add. One copy for
 * the tour page's Itinerary tab (each variant), a season's own itinerary and
 * Create Tour.
 *
 * The host opens a blank day for every day of the tour's length
 * (shared.ts withTourDays); a day left blank is not saved.
 */
import { useState } from "react";
import { ChevronDown, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/components/confirm-provider";
import { cn } from "@/lib/utils";
import { EmptyLine, Field } from "@/components/tours/ui";
import { DragGrip, ImageUrlField, RowControls, dropMarkClass, movedTo, useDragReorder } from "@/components/tours/content/fields";
import { HtmlField } from "@/components/tours/content/html-field";
import { isBlankDay, type ItineraryDay } from "@/components/tours/content/shared";

const isSequential = (days: ItineraryDay[]) => days.every((day, index) => day.n === index + 1);
/** Days numbered 1..N stay numbered 1..N after a move or a removal; hand-set numbers are kept. */
const renumber = (before: ItineraryDay[], after: ItineraryDay[]) =>
  isSequential(before) ? after.map((day, index) => ({ ...day, n: index + 1 })) : after;

export function ItineraryDaysEditor({
  days,
  onChange,
  siteUrl,
  removeNote = "The day will be removed from the itinerary. The change is kept only when you save.",
  tourDays,
}: {
  days: ItineraryDay[];
  onChange: (days: ItineraryDay[]) => void;
  siteUrl: string | null;
  removeNote?: string;
  /** The tour's length (its Days field): says why blank days are waiting to be filled. */
  tourDays?: number | null;
}) {
  const confirm = useConfirm();
  const [openDay, setOpenDay] = useState<number | null>(null);

  const patchDay = (index: number, change: Partial<ItineraryDay>) =>
    onChange(days.map((day, i) => (i === index ? { ...day, ...change } : day)));

  /** The content moves, the day numbers stay where they were. */
  const moveTo = (from: number, to: number) => {
    if (to < 0 || to >= days.length || from === to) return;
    const numbers = days.map((day) => day.n);
    onChange(movedTo(days, from, to).map((day, index) => ({ ...day, n: numbers[index] })));
    setOpenDay((open) => {
      if (open === null) return open;
      if (open === from) return to;
      // the rows between the two places shift by one
      if (from < to && open > from && open <= to) return open - 1;
      if (from > to && open >= to && open < from) return open + 1;
      return open;
    });
  };
  const drag = useDragReorder(moveTo);

  const removeDay = async (index: number) => {
    const day = days[index];
    if (
      !isBlankDay(day) &&
      !(await confirm({
        title: `Remove Day ${day.n}?`,
        description: removeNote,
        confirmLabel: "Remove",
        cancelLabel: "Cancel",
        destructive: true,
      }))
    )
      return;
    onChange(renumber(days, days.filter((_, i) => i !== index)));
    setOpenDay(null);
  };

  const addDay = () => {
    const n = days.reduce((max, day) => Math.max(max, day.n), 0) + 1;
    onChange([...days, { n, title: "", subtitle: "", html: "" }]);
    setOpenDay(days.length);
  };

  const blank = days.filter(isBlankDay).length;

  return (
    <div className="space-y-2">
      {days.length === 0 && <EmptyLine>This itinerary has no days yet. Add the first day.</EmptyLine>}
      {blank > 0 && (
        <p className="text-xs text-muted-foreground">
          {tourDays ? `The tour is ${tourDays} days, so a day was opened for each one. ` : ""}
          {blank} day(s) are still empty - open a day to fill it. A day left empty is not saved and does not show on the site.
        </p>
      )}
      {days.map((day, index) => {
        const open = openDay === index;
        const empty = isBlankDay(day);
        return (
          <div
            key={index}
            {...drag.row(index)}
            className={cn(
              "rounded-lg border bg-card",
              empty && "border-dashed",
              drag.dragging === index && "opacity-50",
              dropMarkClass(drag.mark(index)),
            )}
          >
            <div className="flex items-center gap-2 p-2 ps-2">
              {days.length > 1 && <DragGrip {...drag.grip(index)} />}
              <button
                type="button"
                onClick={() => setOpenDay(open ? null : index)}
                aria-expanded={open}
                className="flex min-w-0 flex-1 items-center gap-3 text-start"
              >
                <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
                <Badge variant="secondary" className="shrink-0">
                  Day {day.n}
                </Badge>
                {empty ? (
                  <span className="min-w-0 truncate text-sm text-muted-foreground">Empty - click to fill</span>
                ) : (
                  <span className="min-w-0 truncate font-medium">{day.title || "Untitled"}</span>
                )}
                {day.subtitle && (
                  <span className="hidden min-w-0 truncate text-sm text-muted-foreground md:inline">{day.subtitle}</span>
                )}
              </button>
              <RowControls
                index={index}
                count={days.length}
                onMove={(delta) => moveTo(index, index + delta)}
                onRemove={() => void removeDay(index)}
                removeLabel="Remove Day"
              />
            </div>
            {open && (
              <div className="space-y-4 border-t p-4">
                <div className="grid gap-4 md:grid-cols-6">
                  <Field label="Day number">
                    <Input
                      type="number"
                      min={1}
                      dir="ltr"
                      value={Number.isFinite(day.n) ? day.n : ""}
                      onChange={(event) => patchDay(index, { n: Math.max(1, Math.trunc(Number(event.target.value)) || 1) })}
                    />
                  </Field>
                  <Field label="Title (the day's route)" className="md:col-span-2">
                    <Input dir="auto" value={day.title} onChange={(event) => patchDay(index, { title: event.target.value })} />
                  </Field>
                  <Field label="Subtitle" className="md:col-span-3">
                    <Input dir="auto" value={day.subtitle} onChange={(event) => patchDay(index, { subtitle: event.target.value })} />
                  </Field>
                </div>
                <ImageUrlField
                  label="Image"
                  value={day.image ?? ""}
                  onChange={(image) => patchDay(index, { image })}
                  siteUrl={siteUrl}
                  folder="itinerary"
                />
                <HtmlField
                  label="Day description"
                  value={day.html}
                  onChange={(html) => patchDay(index, { html })}
                  siteUrl={siteUrl}
                  rows={10}
                />
              </div>
            )}
          </div>
        );
      })}
      <Button type="button" variant="outline" onClick={addDay}>
        <Plus />
        Add Day
      </Button>
    </div>
  );
}
