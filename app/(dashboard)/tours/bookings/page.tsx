import { redirect } from "next/navigation";

/** /tours/bookings - folded into the one Reservations table (14.10.2026): site bookings are its reservations. */
export default function TourBookingsPage() {
  redirect("/tours/reservations?tab=reservations");
}
