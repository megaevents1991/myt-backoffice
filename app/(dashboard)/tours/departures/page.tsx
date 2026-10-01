import { Suspense } from "react";
import { DeparturesBoard } from "@/components/tours/departures/departures-board";

export const metadata = { title: "לוח יציאות" };

/**
 * Departures board of the active company (product type "tours"). The board
 * loads its own data through server actions, so switching company or year
 * never needs a full page render. Suspense: the board reads the query string.
 */
export default function ToursDeparturesPage() {
  return (
    <Suspense fallback={null}>
      <DeparturesBoard />
    </Suspense>
  );
}
