/**
 * One-off: is live_events.ticket_categories[].brt the shelf price customers
 * see on livetickets.co.il? Prints cost / brt for 3 upcoming events so Dor can
 * open the site and compare. Run: node --env-file=.env.local scripts/livetickets-brt-check.ts
 */
import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_SECRET_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("missing NEXT_PUBLIC_SUPABASE_URL / NEXT_SECRET_SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from("live_events")
    .select("event_id,event_name,show_date,currency,ticket_categories")
    .eq("is_active", true)
    .gte("show_date", new Date().toISOString().slice(0, 10))
    .order("show_date")
    .limit(3);
  if (error) {
    console.error(JSON.stringify(error));
    throw error;
  }
  for (const row of data ?? []) {
    console.log(`\n#${row.event_id} ${row.event_name} ${row.show_date} currency=${row.currency}`);
    for (const c of (row.ticket_categories as { title: string; cost: number; brt: number; specialCost: number }[]) ?? []) {
      console.log(`  ${c.title.padEnd(30)} cost=${c.cost}  brt=${c.brt}  specialCost=${c.specialCost}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
