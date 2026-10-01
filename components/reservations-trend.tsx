"use client";

import { TrendChart, type TrendPoint, type TrendRange } from "@/components/dashboard/trend-chart";

async function loadReservationsSeries(range: TrendRange): Promise<TrendPoint[]> {
  const res = await fetch(`/api/dashboard/reservations-series?range=${range}`);
  if (!res.ok) throw new Error("Failed to load series");
  const json = await res.json();
  return json.series as TrendPoint[];
}

/** Paid Mega Events reservations per day. */
export function ReservationsTrend() {
  return (
    <TrendChart
      title="Reservations Over Time"
      seriesLabel="Reservations"
      load={loadReservationsSeries}
    />
  );
}
