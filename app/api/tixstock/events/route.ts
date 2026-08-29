import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";

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

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export async function GET(request: NextRequest) {
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

    // "Has tickets as far as we know": a measured count above zero, or an
    // unknown count on a row the sync touched recently. A *stale* null means
    // the event dropped out of the feed entirely — nothing to buy either way.
    const hasTickets = `ticket_count.gt.0,and(ticket_count.is.null,last_synced.gte.${freshIso})`;
    const noTickets = `ticket_count.eq.0,and(ticket_count.is.null,last_synced.lt.${freshIso})`;

    const filtered = (count?: "exact") => {
      let q = count
        ? supabase.from("tixstock_events").select(EVENT_COLUMNS, { count })
        : supabase.from("tixstock_events").select(EVENT_COLUMNS);

      q = q.not("event_status", "in", NOT_CANCELLED).gte("show_date", leadIso);
      if (query) q = q.ilike("event_name", `%${query}%`);
      if (withTickets) q = q.or(hasTickets);
      return q;
    };

    // Counted rather than returned, so the checkbox's "(N)" stays honest
    // without shipping the rows it is describing.
    let emptyQuery = supabase
      .from("tixstock_events")
      .select("event_id", { count: "exact", head: true })
      .not("event_status", "in", NOT_CANCELLED)
      .gte("show_date", leadIso)
      .or(noTickets);
    if (query) emptyQuery = emptyQuery.ilike("event_name", `%${query}%`);

    // Supabase caps a single REST response at PAGE_SIZE rows, so this is still
    // paged - but over the ~8k rows that survive the filters instead of ~50k,
    // and the exact count is taken once instead of once per page (each one is
    // a seq scan, and 50 of them is what tripped the statement timeout).
    const readPages = async () => {
      const rows: unknown[] = [];
      let total = 0;

      for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
        const first = from === 0;
        const { data, error, count } = await filtered(first ? "exact" : undefined)
          .order("show_date", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);

        if (error) throw error;
        if (first) total = count ?? 0;
        if (data) rows.push(...data);
        if (!data || data.length < PAGE_SIZE) break;
      }

      return { rows, total };
    };

    const [{ rows, total }, empties] = await Promise.all([readPages(), emptyQuery]);

    if (empties.error) throw empties.error;

    return NextResponse.json({
      success: true,
      data: rows,
      meta: {
        total,
        returned: rows.length,
        hiddenEmpty: empties.count ?? 0,
        truncated: rows.length < total,
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
