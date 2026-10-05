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
 *
 * The ids travel in the request line (`event_id=in.(...)`) and are 26 characters
 * each: at 1,000 a batch that was a 27KB URL, which the API refused with a bare
 * 400 - so this cron deleted NOTHING from the day it shipped until 2026-10-05
 * (30,418 rows were waiting, the oldest from May). 200 keeps the line near 5KB.
 */
const BATCH_SIZE = 200;

/** Ceiling per run, reported back rather than silently stopping short. */
const MAX_BATCHES = 400;

/** No new batch starts after this - the run answers well inside maxDuration. */
const TIME_BUDGET_MS = 45_000;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;

  const startedAt = Date.now();
  const cutoff = new Date(
    startedAt - RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  // ?dry_run=1 - how many rows a real run would remove; nothing is deleted.
  if (new URL(request.url).searchParams.get("dry_run") === "1") {
    const { count, error } = await supabase
      .from("tixstock_events")
      .select("event_id", { count: "exact", head: true })
      .lt("show_date", cutoff);
    if (error) {
      console.error("purgeTixstockEvents dry run failed:", JSON.stringify(error));
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, dryRun: true, wouldDelete: count ?? 0, cutoff });
  }

  try {
    let deleted = 0;
    let batches = 0;
    let outOfTime = false;

    for (; batches < MAX_BATCHES; batches++) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        outOfTime = true;
        break;
      }
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

      const { error: deleteError, status } = await supabase
        .from("tixstock_events")
        .delete()
        .in("event_id", ids);

      if (deleteError) {
        // The status is logged on purpose: a refused request line comes back with
        // an EMPTY message, which is how the old 1,000-id batch failed unnoticed.
        console.error(
          `purgeTixstockEvents delete failed (HTTP ${status}):`,
          JSON.stringify(deleteError),
        );
        return NextResponse.json(
          { success: false, error: deleteError.message || `HTTP ${status}`, deleted },
          { status: 500 },
        );
      }

      deleted += doomed.length;
      if (doomed.length < BATCH_SIZE) break;
    }

    const hitCeiling = outOfTime || batches >= MAX_BATCHES;
    console.log(
      `purgeTixstockEvents: deleted ${deleted} events that ended before ${cutoff}` +
        (hitCeiling ? " (stopped at the per-run ceiling, more remain for the next run)" : ""),
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
