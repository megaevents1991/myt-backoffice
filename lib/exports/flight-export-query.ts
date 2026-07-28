import { supabase } from "@/lib/supabase-server";
import type { OfflineFlight } from "@/types/offline-flight.types";

/**
 * Both flight exports accept the same filters as the flights table, so
 * "export what I'm looking at" and "export the selected rows" are one code path.
 */
export async function loadFlightsForExport(url: string): Promise<OfflineFlight[]> {
  const { searchParams } = new URL(url);
  const airline = searchParams.get("airline");
  const from = searchParams.get("from"); // YYYY-MM-DD, inclusive
  const to = searchParams.get("to"); // YYYY-MM-DD, inclusive
  const eventId = searchParams.get("eventId");
  const ids = searchParams.get("ids"); // comma-separated flight ids

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("flights")
    .select("*")
    .eq("is_deleted", false);

  if (airline) query = query.eq("airline_code", airline);
  if (from) query = query.gte("outbound_departure_time", `${from}T00:00:00`);
  if (to) query = query.lte("outbound_departure_time", `${to}T23:59:59`);
  if (eventId && Number.isInteger(Number(eventId))) {
    query = query.contains("event_ids", [Number(eventId)]);
  }
  if (ids) {
    const parsed = ids.split(",").map(Number).filter(Number.isInteger);
    if (parsed.length > 0) query = query.in("id", parsed);
  }
  query = query.order("outbound_departure_time", { ascending: true });

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as OfflineFlight[];
}
