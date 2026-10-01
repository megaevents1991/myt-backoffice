import type { Metadata } from "next";

import { LeadsInbox } from "@/components/tours/content/leads-inbox";

export const metadata: Metadata = { title: "Leads" };

/** /tours/leads - the site leads of a tours company. Data loads through its server actions. */
export default function TourLeadsPage() {
  return <LeadsInbox />;
}
