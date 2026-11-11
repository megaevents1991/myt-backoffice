"use client";

/**
 * The main attractions of a tour (or of a season): a line each, in order, like any list - and two marks per line
 * (Daniel, 10.11.2026): "Country" makes the line a country, so the attractions after it are in that country (the site
 * prints the country in bold in the tour's colour - blue on Mega Family), and a colour paints one attraction so it
 * stands out. The marks are written into the line itself (lib/tours/attractions.ts), so the list stays a list of words.
 *
 * Several lines move together (Liz 11.11: "אפילו אם אפשר לבחור כמה אטרקציות ביחד ולגלול בו זמנית"): a click on the grips
 * picks lines (Shift + click a range), and dragging one of them carries them all, in their order; the list scrolls while
 * a row is held near its top or bottom (useDragReorder).
 */
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Flag, Palette, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ATTRACTION_COLORS, readAttraction, writeAttraction, type AttractionLine } from "@/lib/tours/attractions";
import { cn } from "@/lib/utils";
import { DragGrip, RowControls, dropMarkClass, moved, movedBlock, movedTo, useDragReorder } from "@/components/tours/content/fields";

function ColorPick({ value, onChange, label }: { value: string | null; onChange: (color: string | null) => void; label: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`Colour of ${label}`} title={value ? `Colour ${value}` : "Colour this attraction"}>
          {value ? <span className="h-4 w-4 rounded-full border" style={{ backgroundColor: value }} /> : <Palette />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3">
        <p className="text-sm font-medium">Colour on the site</p>
        <div className="grid grid-cols-4 gap-2">
          {ATTRACTION_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => onChange(c.value)}
              aria-label={c.label}
              aria-pressed={value === c.value}
              title={c.label}
              className={cn("h-9 rounded-md border-2", value === c.value ? "border-foreground" : "border-transparent")}
              style={{ backgroundColor: c.value }}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="color" value={value ?? "#0059AA"} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-8 w-10 cursor-pointer rounded border bg-transparent" />
            Other colour
          </label>
          {value && (
            <Button type="button" variant="ghost" size="sm" className="ms-auto" onClick={() => onChange(null)}>
              <X />
              No colour
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function AttractionsEditor({ label, value, onChange }: { label: string; value: string[]; onChange: (value: string[]) => void }) {
  // the lines picked to move together (their indexes), and the last one clicked, for Shift + click
  const [picked, setPicked] = useState<number[]>([]);
  const lastPick = useRef<number | null>(null);
  // a line added or removed shifts the indexes: the pick starts over
  useEffect(() => {
    setPicked([]);
    lastPick.current = null;
  }, [value.length]);
  const drag = useDragReorder((from, to) => {
    if (picked.length > 1 && picked.includes(from)) {
      const next = movedBlock(value, picked, to, from < to);
      onChange(next.list);
      setPicked(next.at);
      return;
    }
    onChange(movedTo(value, from, to));
    setPicked([]);
  });
  const pick = (index: number, event: MouseEvent) => {
    const from = lastPick.current;
    if (event.shiftKey && from !== null) {
      const [a, b] = from < index ? [from, index] : [index, from];
      const range = Array.from({ length: b - a + 1 }, (_, k) => a + k);
      setPicked((current) => [...new Set([...current, ...range])]);
    } else {
      setPicked((current) => (current.includes(index) ? current.filter((i) => i !== index) : [...current, index]));
    }
    lastPick.current = index;
  };
  // the rows a drag carries: the picked ones when it started on one of them
  const carried = (index: number) =>
    drag.dragging !== null && (drag.dragging === index || (picked.length > 1 && picked.includes(drag.dragging) && picked.includes(index)));
  const lines = value.map(readAttraction);
  const patch = (index: number, change: Partial<AttractionLine>) => onChange(value.map((line, i) => (i === index ? writeAttraction({ ...lines[i], ...change }) : line)));
  const count = lines.filter((a) => !a.country).length;
  return (
    <div className="space-y-2">
      <Label>
        {label} <span className="font-normal text-muted-foreground">({count})</span>
      </Label>
      {picked.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-sm">
          <span>
            {picked.length} picked - drag any of them to move them together. Hold it near the top or the bottom and the list scrolls.
          </span>
          <Button type="button" variant="ghost" size="sm" className="ms-auto h-7" onClick={() => setPicked([])}>
            <X />
            Clear
          </Button>
        </div>
      )}
      <ul className="space-y-1.5">
        {lines.map((a, index) => (
          <li
            key={index}
            {...drag.row(index)}
            className={cn(
              "flex items-center gap-2 rounded-md",
              picked.includes(index) && "bg-primary/10 ring-1 ring-primary/40",
              carried(index) && "opacity-50",
              dropMarkClass(drag.mark(index)),
              a.country && index > 0 && "mt-3",
            )}
          >
            {value.length > 1 && (
              <DragGrip
                {...drag.grip(index)}
                onClick={(event) => pick(index, event)}
                title={picked.includes(index) ? "Picked - drag to move the picked lines together; click to unpick" : "Drag to move - click to pick several lines and move them together"}
              />
            )}
            <Button
              type="button"
              variant={a.country ? "default" : "ghost"}
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-pressed={a.country}
              aria-label={`Line ${index + 1} is a country`}
              title={a.country ? "A country: the attractions after it are in it. Click to make it an attraction again" : "Make this line a country: the attractions after it are in it"}
              onClick={() => patch(index, { country: !a.country, color: null })}
            >
              <Flag />
            </Button>
            <Input
              dir="auto"
              aria-label={`${label} ${index + 1}`}
              placeholder={a.country ? "Country, e.g. אנגליה" : undefined}
              value={a.text}
              onChange={(event) => patch(index, { text: event.target.value })}
              className={cn(a.country && "font-bold text-[#0059AA]")}
              style={a.color ? { color: a.color, fontWeight: 600 } : undefined}
            />
            {!a.country && <ColorPick value={a.color} onChange={(color) => patch(index, { color })} label={a.text || `line ${index + 1}`} />}
            <RowControls index={index} count={value.length} onMove={(delta) => onChange(moved(value, index, delta))} onRemove={() => onChange(value.filter((_, i) => i !== index))} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, ""])}>
          <Plus />
          Add Attraction
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, writeAttraction({ text: "", country: true, color: null })])}>
          <Flag />
          Add Country
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        A country (<Flag className="inline h-3 w-3" />) heads the attractions after it, until the next country; the site prints it in bold in the tour&apos;s colour. The palette (
        <Palette className="inline h-3 w-3" />) paints one attraction in a colour of your choice. Click the grips of several lines (Shift + click
        for a range) and drag one of them to move them together; the list scrolls while you hold it near the top or the bottom.
      </p>
    </div>
  );
}
