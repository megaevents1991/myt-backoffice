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
import { listToursReservations } from "@/lib/actions/tours-reservation-actions";
import { ReservationDialog } from "@/components/tours/reservations/reservation-dialog";
import { ToursReservationsTable } from "@/components/tours/reservations/reservations-table";
import type { ToursReservationRow } from "@/components/tours/reservations/types";
import { Notice, Stat } from "@/components/tours/ui";
import type { DepartureCardData } from "./types";

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
        <Stat label="Allocated" value={allocated} tone={allocated === 0 ? "muted" : "default"} />
        <Stat label="Sold" value={sold} />
        <Stat label="Left" value={remaining} tone={remaining < 0 ? "danger" : allocated === 0 ? "muted" : "default"} />
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
          docketNo: d.docket_no,
        }}
        onCreated={() => void changed()}
      />
    </div>
  );
}
