/**
 * Manual smoke test for the AI judge (lib/services/price-light-judge.ts). Loads one event,
 * pulls up to 5 nearby `liveevents` package listings (±DATE_TOLERANCE_DAYS), calls
 * extractAndJudge, and prints the verdict + its cost.
 *
 * This script (unlike scripts/livetickets-brt-check.ts) pulls in loadEventForLight,
 * which chains through `@/lib/supabase-server` and `@/lib/services/competitor-scrapers` -
 * plain `node --env-file=...` can't resolve those `@/` aliases. Run with tsx instead
 * (it reads tsconfig.json's "paths"):
 *
 *   npx tsx --env-file=.env.local scripts/price-light-judge-smoke.ts <eventId>
 *
 * Do NOT run this without ANTHROPIC_API_KEY set in .env.local and PRICE_LIGHT_AI != "off" -
 * without both, extractAndJudge() just returns an "ai disabled" verdict (no API call, no cost).
 */
import { loadEventForLight } from "@/lib/services/price-light-store";
import { extractAndJudge } from "@/lib/services/price-light-judge";
import { supabase } from "@/lib/supabase-server";
import { DATE_TOLERANCE_DAYS } from "@/lib/services/price-light";
import type { ListingRow } from "@/types/price-light.types";

// New table predates the generated DB types - one boundary cast (repo pattern).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const eventId = Number(process.argv[2]);
  if (!Number.isFinite(eventId)) {
    console.error("usage: npx tsx --env-file=.env.local scripts/price-light-judge-smoke.ts <eventId>");
    process.exit(1);
  }

  const event = await loadEventForLight(eventId);
  if (!event) {
    console.error(`event ${eventId} not found`);
    process.exit(1);
  }

  const day = event.date.slice(0, 10);
  const { data, error } = await db
    .from("competitor_listings")
    .select("id,competitor,external_key,scope,title,title_he,event_date,city,venue,price_from,currency,price_usd,travel_depart,travel_return,attrs,detail_text,url,first_seen_at,last_seen_at,last_changed_at,run_id")
    .eq("competitor", "liveevents")
    .eq("scope", "package")
    .gte("event_date", shiftDay(day, -DATE_TOLERANCE_DAYS))
    .lte("event_date", shiftDay(day, DATE_TOLERANCE_DAYS))
    .order("last_seen_at", { ascending: false })
    .limit(5);
  if (error) {
    console.error("price-light-judge-smoke: candidate query failed", JSON.stringify(error));
    process.exit(1);
  }

  const candidates = (data ?? []) as ListingRow[];
  console.log(`event #${eventId} "${event.name}" (${day}) - ${candidates.length} liveevents candidate(s) within +/-${DATE_TOLERANCE_DAYS}d`);
  if (candidates.length === 0) {
    console.log("nothing to judge - no candidates in range.");
    return;
  }

  const result = await extractAndJudge({ event, candidates });
  console.log(JSON.stringify(result, null, 2));
  console.log(`\ncost: $${result.verdict.cost_usd} (${result.verdict.input_tokens} in / ${result.verdict.output_tokens} out, ${result.verdict.ms}ms)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
