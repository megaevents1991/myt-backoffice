/**
 * Build Your Euro Trip - the Supabase reads behind the reservations chip and panel
 * (the pure rules are in reservation-group.ts; migration 20261021193309_itinerary_core.sql adds
 * the columns).
 *
 * THE LIST AND THE DETAIL PAGE MUST NEVER BREAK BECAUSE OF THESE COLUMNS. A push to master can reach
 * Vercel before the migration has run, and then `itinerary_group` does not exist. So:
 *   - the reservations LIST select is left exactly as it was; the three columns are read by a SECOND,
 *     best-effort query (`loadItineraryMarks`) that asks only for the rows that belong to a trip
 *     (`itinerary_group is not null` - a handful, served by the migration's partial index). Any error
 *     (a missing column included) = no chips, the list is whole;
 *   - the detail page reads the group with `loadItineraryGroup`, which answers null on any error
 *     (= the panel stays hidden) and is never called for a reservation without a group.
 * Both take the Supabase client as an argument so this is testable without a database
 * (scripts/reservation-itinerary-selftest.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPaged } from "@/lib/supabase-paged";
import { isMissingColumn } from "@/lib/services/reservation-follow-ups";
import {
  MAX_TRIP_EVENTS,
  buildItineraryGroup,
  markOf,
  type ItineraryGroup,
  type ItineraryGroupDbRow,
  type ItineraryMark,
  type ItineraryMarkDbRow,
} from "@/lib/itinerary/reservation-group";

/** The client these reads need - a real Supabase client, or a fake one in the selftest. */
export type ReservationsDb = Pick<SupabaseClient, "from">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GROUP_COLUMNS =
  "id,itinerary_seq,itinerary_of,status,final_purchase_price_ils,event_id," +
  "event_order_info,flight_order_info,hotel_order_info,is_deleted";

/**
 * The sibling reservations of one trip. Null - never a throw - when the group is not a uuid, is
 * unknown, when the columns are not migrated yet, or on any other failure: the panel stays hidden.
 */
export async function loadItineraryGroup(db: ReservationsDb, group: string): Promise<ItineraryGroup | null> {
  if (!UUID.test(group)) return null;
  try {
    const { data, error } = await db
      .from("reservations")
      .select(GROUP_COLUMNS)
      .eq("itinerary_group", group)
      .order("itinerary_seq", { ascending: true })
      .order("id", { ascending: true })
      .limit(MAX_TRIP_EVENTS * 3);
    if (error) {
      // A deploy can beat the migration: that window is expected, not worth a log line.
      if (!isMissingColumn(error)) console.error("loadItineraryGroup:", JSON.stringify(error));
      return null;
    }
    return buildItineraryGroup(group, (data ?? []) as unknown as ItineraryGroupDbRow[]);
  } catch (error) {
    console.error("loadItineraryGroup:", error);
    return null;
  }
}

/** More trip rows than this in one list load is not a screen, it is a bug (a trip is 2-3 rows). */
const MARKS_MAX = 5000;

/**
 * reservation id -> its place in a trip, for every reservation that belongs to one.
 *
 * Best effort by design (see the header): the list's own select does not name these columns, so a
 * database that has not run the migration still lists every reservation. Any failure - a missing
 * column, a network blip, a thrown error - returns an EMPTY map: no chips, nothing else changes.
 */
export async function loadItineraryMarks(db: ReservationsDb): Promise<Map<number, ItineraryMark>> {
  try {
    const { rows, truncated, error } = await fetchPaged<ItineraryMarkDbRow>(
      () =>
        db
          .from("reservations")
          .select("id,itinerary_group,itinerary_seq,itinerary_of")
          .not("itinerary_group", "is", null)
          .order("id", { ascending: false }),
      MARKS_MAX,
    );
    if (error) {
      if (!isMissingColumn(error)) console.error("loadItineraryMarks:", JSON.stringify(error));
      return new Map();
    }
    if (truncated) console.error("loadItineraryMarks: hit the paging cap - raise it");
    const marks = new Map<number, ItineraryMark>();
    for (const row of rows) {
      const mark = markOf(row);
      if (mark) marks.set(row.id, mark);
    }
    return marks;
  } catch (error) {
    console.error("loadItineraryMarks:", error);
    return new Map();
  }
}
