import type { Metadata } from "next";

import { BookingsScreen } from "@/components/tours/bookings/bookings-screen";

export const metadata: Metadata = { title: "Online Bookings" };

/** /tours/bookings - what customers booked on the site. Data loads through its server actions. */
export default function TourBookingsPage() {
  return <BookingsScreen />;
}
