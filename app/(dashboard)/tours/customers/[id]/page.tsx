import type { Metadata } from "next";
import { Suspense } from "react";

import { CustomerPage } from "@/components/tours/cases/customer-page";

export const metadata: Metadata = { title: "Customer" };

/** /tours/customers/[id] - one customer and every deal of theirs (Nir 19.10). `?card=` opens one card. */
export default async function TourCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <CustomerPage customerId={id} />
    </Suspense>
  );
}
