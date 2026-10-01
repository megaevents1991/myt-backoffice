import type { Metadata } from "next";

import { ReservationsScreen } from "@/components/tours/reservations/reservations-screen";

export const metadata: Metadata = { title: "Reservations" };

/** /tours/reservations - the Reservations screen of a tours company. Data loads through its server actions. */
export default function ToursReservationsPage() {
  return <ReservationsScreen />;
}
