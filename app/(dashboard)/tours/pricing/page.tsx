import { redirect } from "next/navigation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /tours/pricing was the Pricing sheet. Departures and Pricing are one table now
 * (Alon, 04.10.2026): the sheet lives on /tours/departures, and this address -
 * kept for the links already sent around (`?tour=<id>` from New Series) - opens
 * it on the price columns.
 */
export default async function ToursPricingPage({ searchParams }: { searchParams: Promise<{ tour?: string }> }) {
  const { tour } = await searchParams;
  redirect(`/tours/departures?view=prices${typeof tour === "string" && UUID.test(tour) ? `&tour=${tour}` : ""}`);
}
