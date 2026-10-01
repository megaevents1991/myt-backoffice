"use client";

/**
 * Card tab "Reservations": the bookings of this departure, the same rows and
 * table as the Reservations screen. Sold = the sum of the rows; left = seats
 * of the live flight blocks minus sold. A negative remainder is allowed and
 * shown red.
 */
import { useCallback, useEffect, useState } from "react";
import { PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTableSkeleton } from "@/components/data-table";
import { StatCard } from "@/components/dashboard/stat-card";
import { cn } from "@/lib/utils";
import { listToursReservations } from "@/lib/actions/tours-reservation-actions";
import { ReservationDialog } from "@/components/tours/reservations/reservation-dialog";
import { ToursReservationsTable } from "@/components/tours/reservations/reservations-table";
import type { ToursReservationRow } from "@/components/tours/reservations/types";
import type { DepartureCardData } from "./types";
import { Notice } from "./ui-bits";

export function CardSalesTab({ data, onSaved }: { data: DepartureCardData; onSaved: () => Promise<void> }) {
  const d = data.departure;
  const readOnly = Boolean(d.is_deleted);
  const { allocated, sold, remaining, liveBlocks } = data.stats;
  const [rows, setRows] = useState<ToursReservationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const result = await listToursReservations(d.id);
    if (result.success) {
      setRows(result.data);
      setError(null);
    } else {
      setRows([]);
      setError(result.error);
    }
  }, [d.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // A change moves the departure's seats too: reload the card with the rows.
  const changed = async () => {
    await Promise.all([load(), onSaved()]);
  };

  return (
    <div className="space-y-4 py-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Allocated" value={<span className={cn(allocated === 0 && "text-muted-foreground")}>{allocated}</span>} />
        <StatCard label="Sold" value={sold} />
        <StatCard
          label="Left"
          value={
            <span className={cn(remaining < 0 && "text-destructive", remaining >= 0 && allocated === 0 && "text-muted-foreground")}>
              {remaining}
            </span>
          }
        />
      </div>
      {remaining < 0 && (
        <Notice tone="error">
          Oversold: {Math.abs(remaining)} more seats sold than allocated to this departure
          {liveBlocks === 0 ? " (no live flight block)" : ""}.
        </Notice>
      )}

      {!readOnly && (
        <div className="flex justify-end">
          <Button onClick={() => setAdding(true)}>
            <PlusCircle className="h-4 w-4" />
            Add Reservation
          </Button>
        </div>
      )}

      {error && <Notice tone="error">{error}</Notice>}
      {rows === null ? (
        <DataTableSkeleton rows={4} label="Loading reservations" />
      ) : (
        <ToursReservationsTable rows={rows} oneDeparture readOnly={readOnly} onDeleted={() => void changed()} />
      )}

      <ReservationDialog
        open={adding}
        onOpenChange={setAdding}
        departure={{
          id: d.id,
          code: d.code,
          startDate: d.start_date,
          tourName: data.package?.name ?? null,
        }}
        onCreated={() => void changed()}
      />
    </div>
  );
}
