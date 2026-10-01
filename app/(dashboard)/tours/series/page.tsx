import { Suspense } from "react";
import { SeriesScreen } from "@/components/tours/series/series-screen";

export const metadata = { title: "Series" };

/**
 * Series of the active company (product type "tours"): list, edit and season
 * duplication. The screen loads its data through server actions. Suspense: it
 * reads the query string.
 */
export default function ToursSeriesPage() {
  return (
    <Suspense fallback={null}>
      <SeriesScreen />
    </Suspense>
  );
}
