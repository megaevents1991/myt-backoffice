import { notFound, redirect } from "next/navigation";
import { blockHref } from "@/lib/tours/links";

/**
 * The card of a flight block is /offline-flights/[id], which shows the
 * operations panel for a block of a tours company. This route only redirects
 * there: the deadline tasks saved before the move link to /tours/flights/[id].
 */
export default async function TourBlockPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const flightId = Number(id);
  if (!Number.isInteger(flightId) || flightId <= 0) notFound();
  redirect(blockHref(flightId));
}
