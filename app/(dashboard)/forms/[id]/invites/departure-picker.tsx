"use client";

import { useState } from "react";
import { CalendarDays, Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { TripLinkDeparture } from "@/lib/actions/form-invite-actions";

/** dd/mm/yyyy from yyyy-mm-dd, read as written (a date, not an instant). */
function dmy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

/**
 * Pick the departure a trip link is for: the code and the departure date come from it.
 * Search by code or date; ones that already have a link of this form say so.
 */
export function DeparturePicker({
  departures,
  value,
  onPick,
}: {
  departures: TripLinkDeparture[];
  value: TripLinkDeparture | null;
  onPick: (departure: TripLinkDeparture | null) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-[280px] justify-between font-normal"
          >
            {value ? (
              <span className="flex items-center gap-2">
                <span className="font-mono font-semibold">{value.code}</span>
                <span className="text-muted-foreground">{dmy(value.start_date)}</span>
              </span>
            ) : (
              <span className="flex items-center gap-2 text-muted-foreground">
                <CalendarDays className="h-4 w-4" />
                Pick a departure…
              </span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Code or date (BBC703, 03/07)…" />
            <CommandList className="max-h-[50vh]">
              <CommandEmpty>No departure found.</CommandEmpty>
              <CommandGroup>
                {departures.map((departure) => (
                  <CommandItem
                    key={departure.id}
                    value={`${departure.code} ${dmy(departure.start_date)} ${departure.start_date} ${departure.id}`}
                    onSelect={() => {
                      onPick(departure);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value?.id === departure.id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="font-mono font-semibold">{departure.code}</span>
                    <span className="ms-2 text-muted-foreground">{dmy(departure.start_date)}</span>
                    {departure.links > 0 && (
                      <Badge variant="secondary" className="ms-auto text-[10px]">
                        has a link
                      </Badge>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => onPick(null)}
          aria-label="Clear the departure"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
