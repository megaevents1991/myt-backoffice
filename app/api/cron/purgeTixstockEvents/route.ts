import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";

/**
 * TixStock retention. The sync only ever upserts, so events pile up after they
 * happen - 15,977 dead rows out of 65,964 on 2026-08-29, growing ~2k/day, and
 * every one of them was being counted and paged over by the browse endpoint.
 *
 * Hard delete is correct here: the soft-delete rule covers `events`, not a
 * provider feed cache, and nothing references these rows. A MYT event created
 * from TixStock keeps the link as `tickets_and_rates[].eid`, a JSONB value
 * resolved against the TixStock API - there is no foreign key into this table.
 * Rows are not re-created either: the feed only carries upcoming events.
 *
 * Schedule lives in vercel.json (daily 04:45 UTC, after the nightly syncs).
 */
export const maxDuration = 60;

/** Days after showtime a row is kept. The UI stops showing it 48h *before*. */
const RETENTION_DAYS = 7;

/**
 * Deleted per statement. Batched so one run can never sit on a delete long
 * enough to hit Postgres' statement timeout, whatever the backlog.
 */
const BATCH_SIZE = 1000;

/** Ceiling per run, reported back rather than silently stopping short. */
const MAX_BATCHES = 50;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;

  const cutoff = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  try {
    let deleted = 0;
    let batches = 0;

    for (; batches < MAX_BATCHES; batches++) {
      const { data: doomed, error: selectError } = await supabase
        .from("tixstock_events")
        .select("event_id")
        .lt("show_date", cutoff)
        .limit(BATCH_SIZE);

      if (selectError) {
        console.error(
          "purgeTixstockEvents select failed:",
          JSON.stringify(selectError),
        );
        return NextResponse.json(
          { success: false, error: selectError.message, deleted },
          { status: 500 },
        );
      }

      if (!doomed || doomed.length === 0) break;

      // The generated types narrow a partial select on this table to `never`
      // (same quirk lib/services/tixstock-sync.ts works around) - name the row.
      const ids = (doomed as Array<{ event_id: string }>).map(
        (row) => row.event_id,
      );

      const { error: deleteError } = await supabase
        .from("tixstock_events")
        .delete()
        .in("event_id", ids);

      if (deleteError) {
        console.error(
          "purgeTixstockEvents delete failed:",
          JSON.stringify(deleteError),
        );
        return NextResponse.json(
          { success: false, error: deleteError.message, deleted },
          { status: 500 },
        );
      }

      deleted += doomed.length;
      if (doomed.length < BATCH_SIZE) break;
    }

    const hitCeiling = batches >= MAX_BATCHES;
    console.log(
      `purgeTixstockEvents: deleted ${deleted} events that ended before ${cutoff}` +
        (hitCeiling ? " (hit the per-run ceiling, more remain)" : ""),
    );

    return NextResponse.json({ success: true, deleted, cutoff, hitCeiling });
  } catch (error) {
    console.error("purgeTixstockEvents failed:", error);
    return NextResponse.json(
      { success: false, error: "Unexpected error" },
      { status: 500 },
    );
  }
}
