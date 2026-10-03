import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { PricingSheet } from "@/components/tours/pricing/pricing-sheet";

export const metadata: Metadata = { title: "Pricing" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /tours/pricing - every sub-tour of the organized tours as one sheet, tour by
 * tour. `?tour=<id>` opens it on one tour (the answer of New Series links here).
 * The sheet loads and saves through its own server actions.
 */
export default async function ToursPricingPage({ searchParams }: { searchParams: Promise<{ tour?: string }> }) {
  const { tour } = await searchParams;
  return (
    <div className="space-y-2">
      <PageHeader
        title="Pricing"
        description="Every sub-tour of the organized tours, tour by tour, like a spreadsheet: the six room prices, the status, on the site or not, and the details of each date. Edit cells, paste from Excel or set many rows at once - the changes are marked until you click Save."
      />
      <PricingSheet focusTour={typeof tour === "string" && UUID.test(tour) ? tour : null} />
    </div>
  );
}
