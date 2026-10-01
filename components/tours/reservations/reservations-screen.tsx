"use client";

import { useCallback, useEffect, useState } from "react";
import { PlusCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { DataTableSkeleton } from "@/components/data-table";
import { useToast } from "@/hooks/use-toast";
import { listToursReservations } from "@/lib/actions/tours-reservation-actions";
import { ReservationDialog } from "@/components/tours/reservations/reservation-dialog";
import { ToursReservationsTable } from "@/components/tours/reservations/reservations-table";
import type { ToursReservationRow } from "@/components/tours/reservations/types";

/** /tours/reservations - every booking of the company, like the Mega Events Reservations screen. */
export function ReservationsScreen() {
  const { toast } = useToast();
  const [rows, setRows] = useState<ToursReservationRow[] | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const result = await listToursReservations();
    if (result.success) setRows(result.data);
    else {
      setRows((current) => current ?? []);
      toast({ variant: "destructive", title: "Error", description: result.error });
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reservations"
        description="Bookings taken by phone, by agents or in the office - one row per booking or cancellation, with the customer and the Docket number. The travelers count on the departure's seats. Deleting only marks a row deleted; it stays recoverable."
        actions={
          <>
            <Button variant="outline" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button onClick={() => setAdding(true)}>
              <PlusCircle className="h-4 w-4" />
              Add Reservation
            </Button>
          </>
        }
      />

      {rows === null ? (
        <DataTableSkeleton rows={12} label="Loading reservations" />
      ) : (
        <ToursReservationsTable
          rows={rows}
          onDeleted={(id) => setRows((current) => current?.filter((r) => r.id !== id) ?? null)}
        />
      )}

      <ReservationDialog
        open={adding}
        onOpenChange={setAdding}
        onCreated={(row) => setRows((current) => [row, ...(current ?? [])])}
      />
    </div>
  );
}
