import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";
import { guardAdminRoute } from "@/lib/auth/guards";

/**
 * The TixStock browser holds this entire response in memory and filters it in
 * JS, so the row count is the only thing that matters here. Unfiltered it was
 * 49,987 rows / 49 MB / ~40s (2026-08-29, after the feed grew from 542 to 989
 * pages) and the page stopped loading — while the UI only ever renders the
 * ~8k events that actually have tickets. Every filter the UI applies to the
 * result is now applied in SQL instead.
 */

/**
 * What the browser and the detail page actually read. `sub_categories` is
 * written by the sync and never read back — 19% of the payload for nothing.
 */
const EVENT_COLUMNS =
  "event_id,event_name,show_date,event_status,venue_name,city_name,country_code," +
  "venue_data,venue_map_url,category_name,performers,last_synced,is_active,ticket_count";

/** Mirrors MIN_LEAD_MS / STALE_SYNC_MS in tixstock-events-content.tsx. */
const MIN_LEAD_MS = 48 * 60 * 60 * 1000;
const STALE_SYNC_MS = 48 * 60 * 60 * 1000;

/** Supabase's REST layer will not return more than this in one response. */
const PAGE_SIZE = 1000;

/**
 * Ceiling for the "show ticketless events too" opt-in, which has no natural
 * upper bound of its own. Reported back as `meta.truncated` — never silent.
 */
const MAX_ROWS = 10000;

const NOT_CANCELLED = '("Cancelled","Deleted")';

/** The two columns the route itself reads; the rest of a row passes through untouched. */
type EventRow = { show_date: string; event_id: string };

/** The order every set is read in - kept when two sets are merged into one list. */
function byShowDateThenId(a: EventRow, b: EventRow): number {
  if (a.show_date !== b.show_date) return a.show_date < b.show_date ? -1 : 1;
  if (a.event_id === b.event_id) return 0;
  return a.event_id < b.event_id ? -1 : 1;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export async function GET(request: NextRequest) {
  // Staff only - until 05.10 this answered anyone on the internet, no session needed.
  const denied = await guardAdminRoute();
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query");
    const eventId = searchParams.get("event_id");
    // Default matches the UI's "Hide events without tickets" checkbox default.
    const withTickets = searchParams.get("with_tickets") !== "0";

    // Single-event lookup for the detail page, which used to download every
    // future event and find one row in JS.
    if (eventId) {
      const { data, error } = await supabase
        .from("tixstock_events")
        .select(EVENT_COLUMNS)
        .eq("event_id", eventId)
        .maybeSingle();

      if (error) throw error;
      return NextResponse.json({ success: true, data: data ? [data] : [] });
    }

    const now = Date.now();
    const leadIso = new Date(now + MIN_LEAD_MS).toISOString();
    const freshIso = new Date(now - STALE_SYNC_MS).toISOString();

    // Future, not cancelled, matching the search - what every read below starts from.
    const upcoming = () => {
      let q = supabase
        .from("tixstock_events")
        .select(EVENT_COLUMNS)
        .not("event_status", "in", NOT_CANCELLED)
        .gte("show_date", leadIso);
      if (query) q = q.ilike("event_name", `%${query}%`);
      return q;
    };
    type Upcoming = ReturnType<typeof upcoming>;

    // Supabase caps a single REST response at PAGE_SIZE rows, so a set is read
    // in pages, one after the other - each page re-runs the filter and sort,
    // and eight of those at once died on the statement timeout (2026-08-29).
    //
    // No exact count anywhere: counting is a read of the whole 116 MB table,
    // and that is what answered 500 on 2026-10-06. A page that comes back
    // short says the set ended; reaching MAX_ROWS says it did not.
    const readSet = async (scope: (q: Upcoming) => Upcoming) => {
      const rows: EventRow[] = [];

      for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
        // event_id breaks ties. Hundreds of events share a show_date, and with
        // a non-total order Postgres is free to place tied rows differently
        // per query - so an OFFSET page could repeat a row the previous page
        // already returned and drop another entirely. Measured: 7 duplicates
        // and 7 missing rows across 8 pages before the tiebreaker.
        const { data, error } = await scope(upcoming())
          .order("show_date", { ascending: true })
          .order("event_id", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);

        if (error) throw error;
        const page = (data ?? []) as unknown as EventRow[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) return { rows, truncated: false };
      }

      return { rows, truncated: true };
    };

    if (!withTickets) {
      const all = await readSet((q) => q);
      return NextResponse.json({
        success: true,
        data: all.rows,
        meta: {
          total: all.rows.length,
          returned: all.rows.length,
          // The screen counts the ticketless rows it is showing by itself.
          hiddenEmpty: 0,
          truncated: all.truncated,
        },
      });
    }

    // "Has tickets as far as we know" is two sets, read as two plain filters
    // so each walks its own small index (migration 20261007062437) - written
    // as one OR, neither index applies and every page scans the whole table:
    //   - a measured count above zero (~8,600 of 105,000 rows);
    //   - an unknown count on a row the sync touched recently. A *stale* null
    //     means the event dropped out of the feed - nothing to buy either way.
    const noTickets = `ticket_count.eq.0,and(ticket_count.is.null,last_synced.lt.${freshIso})`;

    // The checkbox's "(~N)": what the filter hides, without shipping the rows.
    // The planner's estimate, not a count - 90,000 rows cannot be counted
    // without reading them. Measured 2026-10-07: 89,535 against 89,543 real.
    let emptyQuery = supabase
      .from("tixstock_events")
      .select("event_id", { count: "planned", head: true })
      .not("event_status", "in", NOT_CANCELLED)
      .gte("show_date", leadIso)
      .or(noTickets);
    if (query) emptyQuery = emptyQuery.ilike("event_name", `%${query}%`);

    const [sellable, unknown, empties] = await Promise.all([
      readSet((q) => q.gt("ticket_count", 0)),
      readSet((q) => q.is("ticket_count", null).gte("last_synced", freshIso)),
      emptyQuery,
    ]);

    // The number is a label, never a reason to fail the list.
    if (empties.error) {
      console.error("TixStock hidden-events estimate failed:", JSON.stringify(empties.error));
    }

    const merged = [...sellable.rows, ...unknown.rows].sort(byShowDateThenId);
    const rows = merged.slice(0, MAX_ROWS);

    return NextResponse.json({
      success: true,
      data: rows,
      meta: {
        total: rows.length,
        returned: rows.length,
        hiddenEmpty: empties.count ?? 0,
        truncated: sellable.truncated || unknown.truncated || merged.length > MAX_ROWS,
      },
    });
  } catch (error) {
    // Supabase rejects with a plain `{ code, message, details, hint }`, not an
    // Error - `String(error)` on that is "[object Object]".
    console.error("TixStock events fetch failed:", JSON.stringify(error));
    return NextResponse.json(
      {
        success: false,
        error: errorMessage(error),
      },
      { status: 500 },
    );
  }
}
