"use client";

import { PageHeader } from "@/components/page-header";
import { ReservationsTable } from "./reservations-table";

// No "Add Reservation": bookings are written by the customer site at checkout,
// and /reservations/new has no route (it fell through to [id] as "not found").
export default function ReservationsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Reservations"
        description="Customer bookings, written here by the customer site at checkout - one row per order, with its package contents, payment status and the partner it came from. Deleting only marks a row deleted; it stays recoverable."
      />

      <ReservationsTable />
    </div>
  );
}
