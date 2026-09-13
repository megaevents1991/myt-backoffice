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
 *   npx tsx --env-file=.env.local scripts/price-light-judge-smoke.ts <eventId> [competitor]
 *
 * Needs a real console key in ANTHROPIC_API_KEY and PRICE_LIGHT_AI=on; it checks both up front
 * and tells you which one is missing instead of printing an "ai disabled" verdict. This is the
 * ONE call to make before turning the AI on for the nightly: it proves the key, the model id,
 * the forced tool call and the token accounting on a single real event, for about 3 cents.
 */
import { loadEventForLight } from "@/lib/services/price-light-store";
import { aiEnabled, aiModel, anthropicKey, extractAndJudge } from "@/lib/services/price-light-judge";
import { loadJudgeMemory } from "@/lib/services/price-light-memory";
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
  const competitor = process.argv[3] ?? null;
  if (!Number.isFinite(eventId)) {
    console.error("usage: npx tsx --env-file=.env.local scripts/price-light-judge-smoke.ts <eventId> [competitor]");
    process.exit(1);
  }

  // Diagnose the switches BEFORE touching the database, so a missing key reads as a missing
  // key rather than as an empty result or a bland "ai disabled" verdict.
  if (!aiEnabled()) {
    const switchOn = process.env.PRICE_LIGHT_AI === "on";
    console.error("the judge is off, so this would make no API call. Fix and re-run:");
    if (!switchOn) console.error(`  - PRICE_LIGHT_AI is "${process.env.PRICE_LIGHT_AI ?? "(unset)"}" - set it to exactly "on"`);
    if (!anthropicKey()) console.error(`  - ANTHROPIC_API_KEY is ${process.env.ANTHROPIC_API_KEY?.trim() ? "not a console key (it must start with \"sk-ant-\")" : "empty"} - paste the key from console.anthropic.com`);
    process.exit(1);
  }
  console.log(`model: ${aiModel()}`);

  const event = await loadEventForLight(eventId);
  if (!event) {
    console.error(`event ${eventId} not found`);
    process.exit(1);
  }

  const day = event.date.slice(0, 10);
  // Any competitor by default (pass one as argv[3] to pin it): hardcoding `liveevents` made
  // this print "nothing to judge" whenever that site happened not to be the one crawled last.
  // Window listings (ISSTA/OnTour publish no match date) are included the same way
  // `candidatesFor` includes them, or the smoke test could not reach half the catalog.
  let query = db
    .from("competitor_listings")
    .select("id,competitor,external_key,scope,title,title_he,event_date,city,venue,price_from,currency,price_usd,travel_depart,travel_return,attrs,detail_text,url,first_seen_at,last_seen_at,last_changed_at,run_id")
    .or(`and(event_date.gte.${shiftDay(day, -DATE_TOLERANCE_DAYS)},event_date.lte.${shiftDay(day, DATE_TOLERANCE_DAYS)}),and(event_date.is.null,travel_depart.lte.${day},travel_return.gte.${day})`)
    .order("last_seen_at", { ascending: false })
    .limit(5);
  if (competitor) query = query.eq("competitor", competitor);
  const { data, error } = await query;
  if (error) {
    console.error("price-light-judge-smoke: candidate query failed", JSON.stringify(error));
    process.exit(1);
  }

  const candidates = (data ?? []) as ListingRow[];
  console.log(`event #${eventId} "${event.name}" (${day}) - ${candidates.length} ${competitor ?? "any-competitor"} candidate(s) within +/-${DATE_TOLERANCE_DAYS}d or covering the date`);
  if (candidates.length === 0) {
    console.log("nothing to judge - no candidates in range.");
    return;
  }

  // Exactly what the nightly sends: the agent's house rules plus whatever staff corrections
  // exist so far. Printed, because "what does it actually know?" is the first question anyone
  // asks about an agent - and the answer must be readable before the first bill.
  const memory = await loadJudgeMemory();
  console.log(`\n--- agent memory (${memory.length} chars) ---\n${memory}\n--- end memory ---\n`);

  const result = await extractAndJudge({ event, candidates }, { memory });
  console.log(JSON.stringify(result, null, 2));
  console.log(`\ncost: $${result.verdict.cost_usd} (${result.verdict.input_tokens} in / ${result.verdict.output_tokens} out, ${result.verdict.ms}ms)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
