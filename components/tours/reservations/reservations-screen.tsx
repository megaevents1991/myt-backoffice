"use client";

import { useState } from "react";
import { PlusCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { DataTableSkeleton } from "@/components/data-table";
import { useActionData } from "@/hooks/use-action-data";
import { listToursReservations } from "@/lib/actions/tours-reservation-actions";
import { LoadError } from "@/components/tours/ui";
import { ReservationDialog } from "@/components/tours/reservations/reservation-dialog";
import { ToursReservationsTable } from "@/components/tours/reservations/reservations-table";

/** /tours/reservations - every booking of the company, like the Mega Events Reservations screen. */
export function ReservationsScreen() {
  const { data: rows, error, loading, reload, setData: setRows } = useActionData(() => listToursReservations(), []);
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reservations"
        description="Bookings taken by phone, by agents or in the office - one row per booking or cancellation, with the customer and the Docket number. The travelers count on the departure's seats. Deleting only marks a row deleted; it stays recoverable."
        actions={
          <>
            <Button variant="outline" onClick={() => void reload()}>
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

      {error && !loading && <LoadError message={error} onRetry={() => void reload()} />}
      {rows ? (
        <ToursReservationsTable
          rows={rows}
          onDeleted={(id) => setRows((current) => current?.filter((r) => r.id !== id) ?? null)}
        />
      ) : (
        loading && <DataTableSkeleton rows={12} label="Loading reservations" />
      )}

      <ReservationDialog
        open={adding}
        onOpenChange={setAdding}
        onCreated={(row) => setRows((current) => [row, ...(current ?? [])])}
      />
    </div>
  );
}
