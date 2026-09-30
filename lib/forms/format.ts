/**
 * Display formatting shared by the trips report screen (client) and its PDF
 * export (server) - a plain module, so both sides can import it.
 */

import type { TravelerStat, TravelerTotals } from "@/lib/forms/report";

/** yyyy-mm-dd (or an ISO timestamp) -> dd.mm.yyyy. */
export function fmtDate(iso: string | null): string {
  if (!iso) return "-";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

export function fmtAvg(avg: number | null): string {
  return avg === null ? "-" : avg.toFixed(2);
}

/**
 * "15 / 17" - travellers the answers account for, of the trip's staff-set
 * size. With no size set, the reported number stands alone.
 */
export function fmtTravelers(stat: TravelerStat | TravelerTotals | null): string {
  if (!stat) return "-";
  if (stat.total !== null) return `${stat.reported} / ${stat.total}`;
  return stat.forms > 0 ? String(stat.reported) : "-";
}
