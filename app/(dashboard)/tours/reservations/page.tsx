import type { Metadata } from "next";
import { Suspense } from "react";

import { DataTableSkeleton } from "@/components/data-table";
import { BoardScreen } from "@/components/tours/cases/board-screen";

export const metadata: Metadata = { title: "Reservations" };

/**
 * /tours/reservations - TODAY | RESERVATIONS | LEADS | ALL of a tours company (Nir 19.10): the customers' deal
 * cards, every order and every lead. Data loads through its server actions; the tab sits in the URL, so the
 * screen is under Suspense.
 */
export default function ToursReservationsPage() {
  return (
    <Suspense fallback={<DataTableSkeleton rows={12} label="Loading reservations" />}>
      <BoardScreen />
    </Suspense>
  );
}
