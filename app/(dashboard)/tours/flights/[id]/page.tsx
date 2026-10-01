import { notFound } from "next/navigation";
import { TourBlockView } from "@/components/tours/flights/tour-block-view";

/**
 * Block card of a tours company: the flight in both directions and the
 * operations panel. The panel's actions are company-scoped, so the id of a
 * flight of another company shows "not found".
 */
export default async function TourBlockPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const flightId = Number(id);
  if (!Number.isInteger(flightId) || flightId <= 0) notFound();
  return <TourBlockView flightId={flightId} />;
}
