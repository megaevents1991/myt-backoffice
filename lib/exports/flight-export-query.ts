import { fetchPaged } from "@/lib/supabase-paged";
import { flightsOf, type FlightScope } from "@/lib/flights-scope";
import type { OfflineFlight } from "@/types/offline-flight.types";

/** Far above any company's real inventory; the export pages through PostgREST's 1000-row cap. */
const EXPORT_MAX = 20_000;

/**
 * Both flight exports accept the same filters as the flights table, so
 * "export what I'm looking at" and "export the selected rows" are one code path.
 *
 * `company` is the ACTIVE company, resolved by the route (getActiveCompany).
 * It is not optional and not read from the URL: an `ids=` list naming a flight
 * of another company exports nothing for that id.
 */
export async function loadFlightsForExport(
  url: string,
  company: FlightScope,
): Promise<OfflineFlight[]> {
  const { searchParams } = new URL(url);
  const airline = searchParams.get("airline");
  const from = searchParams.get("from"); // YYYY-MM-DD, inclusive
  const to = searchParams.get("to"); // YYYY-MM-DD, inclusive
  const eventId = searchParams.get("eventId");
  const ids = searchParams.get("ids"); // comma-separated flight ids

  const parsedIds = ids
    ? ids.split(",").map(Number).filter(Number.isInteger)
    : [];

  const makeQuery = () => {
    let query = flightsOf(company).select("*").eq("is_deleted", false);

    if (airline) query = query.eq("airline_code", airline);
    if (from) query = query.gte("outbound_departure_time", `${from}T00:00:00`);
    if (to) query = query.lte("outbound_departure_time", `${to}T23:59:59`);
    if (eventId && Number.isInteger(Number(eventId))) {
      query = query.contains("event_ids", [Number(eventId)]);
    }
    if (parsedIds.length > 0) query = query.in("id", parsedIds);
    return query
      .order("outbound_departure_time", { ascending: true })
      .order("id", { ascending: true });
  };

  const { rows, truncated, error } = await fetchPaged<OfflineFlight>(
    makeQuery,
    EXPORT_MAX,
  );
  if (error) throw error;
  if (truncated) {
    console.error(`loadFlightsForExport: more than ${EXPORT_MAX} flights - export truncated`);
  }
  return rows;
}
