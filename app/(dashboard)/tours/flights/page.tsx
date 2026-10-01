import { redirect } from "next/navigation";

/** The flight blocks and the card of each one live on the offline-flights screen. */
export default function TourFlightsIndexPage() {
  redirect("/offline-flights");
}
