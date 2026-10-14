import type { Metadata } from "next";

import { CasePage } from "@/components/tours/cases/case-page";

export const metadata: Metadata = { title: "Reservation" };

/** /tours/reservations/[id] - one customer's case. Data loads through its server action. */
export default async function TourCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CasePage id={id} />;
}
