"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "react-hot-toast";
import { useConfirm } from "@/components/confirm-provider";
import { X } from "lucide-react";
import type { FlightAllocationRow } from "@/types/offline-flight.types";
import {
  getFlightAllocations,
  removeFlightAllocation,
  setFlightAllocation,
} from "@/lib/actions/flight-allocation-actions";

export type FlightAllocationsPanelProps = {
  flightId: number;
  /** Highlights this event's row; passed by the event page. */
  highlightEventId?: number;
  onChanged?: () => void;
};

export function FlightAllocationsPanel({
  flightId,
  highlightEventId,
  onChanged,
}: FlightAllocationsPanelProps) {
  const [rows, setRows] = useState<FlightAllocationRow[]>([]);
  const [initialQuantity, setInitialQuantity] = useState(0);
  const [unallocated, setUnallocated] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [isPending, startTransition] = useTransition();
  const confirm = useConfirm();

  const reload = useCallback(async () => {
    try {
      const data = await getFlightAllocations(flightId);
      setRows(data.rows);
      setInitialQuantity(data.initial_quantity);
      setUnallocated(data.unallocated);
    } catch (error) {
      console.error("Failed to load allocations:", error);
      toast.error("Could not load seat allocations.");
    } finally {
      setIsLoading(false);
    }
  }, [flightId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * The most seats this event may hold: everything not spoken for by the other
   * events, plus whatever it already holds itself. Typing past this is blocked
   * at the input rather than bounced by the server after the fact.
   */
  const maxFor = (row: FlightAllocationRow): number =>
    unallocated + (row.allocated_seats ?? 0);

  const save = (eventId: number, raw: string) => {
    const seats = Number.parseInt(raw, 10);
    if (!Number.isInteger(seats) || seats < 0) {
      toast.error("Seats must be a non-negative whole number");
      return;
    }
    const row = rows.find((r) => r.event_id === eventId);
    if (row) {
      const ceiling = maxFor(row);
      if (seats > ceiling) {
        toast.error(
          `Only ${ceiling} seat(s) available on this flight - the rest are allocated to other events`,
        );
        return;
      }
      if (seats < row.consumed_seats) {
        toast.error(
          `This event has already sold ${row.consumed_seats} seat(s) - it cannot go below that`,
        );
        return;
      }
    }
    startTransition(async () => {
      try {
        await setFlightAllocation(flightId, eventId, seats);
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[eventId];
          return next;
        });
        await reload();
        onChanged?.();
      } catch (error) {
        console.error("Failed to set allocation:", error);
        toast.error(error instanceof Error ? error.message : "Allocation failed");
      }
    });
  };

  const remove = async (eventId: number) => {
    if (
      !(await confirm({
        title: "Remove this allocation?",
        description: "The event returns to the global pool.",
        confirmLabel: "Remove",
        destructive: true,
      }))
    ) {
      return;
    }
    startTransition(async () => {
      try {
        await removeFlightAllocation(flightId, eventId);
        await reload();
        onChanged?.();
      } catch (error) {
        console.error("Failed to remove allocation:", error);
        toast.error("Could not remove the allocation");
      }
    });
  };

  if (isLoading) {
    return <div className="p-3 text-sm text-muted-foreground">Loading allocations…</div>;
  }

  if (rows.length === 0) {
    return (
      <div className="p-3 text-sm text-muted-foreground">
        This flight is not linked to any event yet.
      </div>
    );
  }

  return (
    <div className="space-y-2 p-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-muted-foreground">
            <th className="py-1">Event</th>
            <th className="w-32 py-1 text-right">ORG</th>
            <th className="w-20 py-1 text-right">TAKEN</th>
            <th className="w-24 py-1 text-right">AVAILABLE</th>
            <th className="w-16" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const draft = drafts[row.event_id];
            const allocated = row.allocated_seats;
            const available =
              allocated === null ? null : allocated - row.consumed_seats;
            return (
              <tr
                key={row.event_id}
                className={
                  row.event_id === highlightEventId ? "bg-primary/5 font-medium" : ""
                }
              >
                <td className="py-1">
                  {row.event_name}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {String(row.event_date).slice(0, 10)}
                  </span>
                </td>
                <td className="py-1 text-right">
                  {allocated === null && draft === undefined ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7"
                      disabled={isPending}
                      onClick={() =>
                        setDrafts((prev) => ({
                          ...prev,
                          [row.event_id]: String(Math.max(maxFor(row), 0)),
                        }))
                      }
                    >
                      Allocate
                    </Button>
                  ) : (
                    <Input
                      className="h-7 text-right"
                      type="number"
                      // Floor = seats this event has already sold; ceiling =
                      // what is genuinely free on the flight.
                      min={row.consumed_seats}
                      max={maxFor(row)}
                      value={draft ?? String(allocated ?? 0)}
                      disabled={isPending}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [row.event_id]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") save(row.event_id, e.currentTarget.value);
                      }}
                      onBlur={(e) => {
                        if (e.currentTarget.value === String(allocated ?? "")) return;
                        save(row.event_id, e.currentTarget.value);
                      }}
                    />
                  )}
                </td>
                <td className="py-1 text-right">{row.consumed_seats}</td>
                <td className="py-1 text-right">
                  {available === null ? (
                    <span className="text-xs text-muted-foreground">global pool</span>
                  ) : (
                    <span
                      className={
                        available > 0
                          ? "font-medium text-green-600"
                          : "font-medium text-red-600"
                      }
                    >
                      {available}
                    </span>
                  )}
                </td>
                <td className="py-1 pl-6 text-right">
                  {allocated !== null && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
                      title="Remove allocation"
                      disabled={isPending}
                      onClick={() => remove(row.event_id)}
                    >
                      <X className="h-4 w-4" />
                      <span className="sr-only">Remove allocation</span>
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="text-xs">
        <span className={unallocated < 0 ? "font-medium text-red-600" : "text-muted-foreground"}>
          Unallocated: {unallocated} of {initialQuantity}
        </span>
        {unallocated < 0 && (
          <span className="ml-2 text-red-600">
            - allocations exceed the flight&apos;s seat count. Raise ORG or lower an
            allocation.
          </span>
        )}
      </div>
    </div>
  );
}
