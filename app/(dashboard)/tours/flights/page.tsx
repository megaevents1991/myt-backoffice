import { redirect } from "next/navigation";

/** The list of flight blocks lives on the offline-flights screen; only the block card is under /tours/flights. */
export default function TourFlightsIndexPage() {
  redirect("/offline-flights");
}
