import type { Metadata } from "next";
import { Suspense } from "react";

import { CustomerPage } from "@/components/tours/cases/customer-page";

export const metadata: Metadata = { title: "Customer" };

/** /tours/reservations/[id] - a card: its customer's page with that card open (Nir 19.10). */
export default async function TourCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <CustomerPage cardId={id} />
    </Suspense>
  );
}
