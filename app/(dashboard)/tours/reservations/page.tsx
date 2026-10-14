import type { Metadata } from "next";
import { Suspense } from "react";

import { DataTableSkeleton } from "@/components/data-table";
import { CasesScreen } from "@/components/tours/cases/cases-screen";

export const metadata: Metadata = { title: "Reservations" };

/**
 * /tours/reservations - one table for every lead and every reservation of a
 * tours company (Leads and Online Bookings fold into it). Data loads through
 * its server actions; the view sits in the URL, so the screen is under Suspense.
 */
export default function ToursReservationsPage() {
  return (
    <Suspense fallback={<DataTableSkeleton rows={12} label="Loading reservations" />}>
      <CasesScreen />
    </Suspense>
  );
}
