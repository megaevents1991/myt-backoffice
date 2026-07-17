import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import {
  campaignInputHash,
  generateCampaignForEvent,
  type CampaignEventRow,
} from "@/lib/creative/auto";

/**
 * Nightly campaign creatives for the Meta product feed. Walks feed-eligible
 * events (same window the feed serves: not deleted, today onward), finds ones
 * whose input hash changed (new event / price / date / name), and regenerates
 * with the SAME auto-derive + render pipeline the creative designer uses.
 * Any derivation warning skips the event — the feed then falls back to the
 * event's original card image. Batched: at most MAX_PER_RUN renders per
 * night, oldest events first, so a big backlog catches up over a few runs.
 */
export const maxDuration = 300;

const MAX_PER_RUN = 40;
const TIME_BUDGET_MS = 250_000; // leave headroom under maxDuration

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;

  const started = Date.now();
  const todayISO = new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("events")
    .select(
      "id,name,name_english,type,date,location,base_flight_price,base_hotel_price,tickets_and_rates,event_additional_markup,markup_ticket,markup_flight,markup_hotel,skip_flight,art_image_url,card_image_url,campaign_input_hash",
    )
    .is("is_deleted", null)
    .gte("date", todayISO)
    .order("date", { ascending: true });
  if (error) {
    console.error("[campaign-cron] events query failed:", JSON.stringify(error));
    return NextResponse.json({ error: "events query failed" }, { status: 500 });
  }

  const events = (data ?? []) as unknown as CampaignEventRow[];
  const summary = {
    scanned: events.length,
    current: 0,
    generated: [] as number[],
    skipped: [] as { id: number; reason: string }[],
    errors: [] as { id: number; error: string }[],
    stoppedEarly: false,
  };

  let processed = 0;
  for (const event of events) {
    // Cheap pre-check so "current" events don't count against the batch.
    if (event.campaign_input_hash === campaignInputHash(event)) {
      summary.current++;
      continue;
    }
    if (processed >= MAX_PER_RUN || Date.now() - started > TIME_BUDGET_MS) {
      summary.stoppedEarly = true;
      break;
    }
    processed++;
    try {
      const result = await generateCampaignForEvent(event);
      if (result.status === "generated") summary.generated.push(event.id);
      else if (result.status === "skipped")
        summary.skipped.push({ id: event.id, reason: result.reason });
      else summary.current++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[campaign-cron] event ${event.id} failed:`, message);
      summary.errors.push({ id: event.id, error: message });
    }
  }

  console.log(
    `[campaign-cron] scanned=${summary.scanned} current=${summary.current} generated=${summary.generated.length} skipped=${summary.skipped.length} errors=${summary.errors.length}${summary.stoppedEarly ? " (stopped early)" : ""}`,
  );
  return NextResponse.json(summary);
}
