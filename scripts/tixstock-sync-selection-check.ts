/**
 * Read-only check of the TixStock price sync's event selection (`loadEvents` in
 * lib/services/tixstock-price-sync.ts): the selection without the test-event filter against the same
 * selection with it (`tixstock_booking is null OR is_test is false`). Reads PRODUCTION (.env.local) and
 * writes nothing. A dry run of the cron under `npm run dev` reads the LOCAL Supabase and proves nothing here.
 *
 *   npx tsx --env-file=.env.local scripts/tixstock-sync-selection-check.ts
 *
 * Passes when the filter drops nothing but sandbox test events (is_test AND tixstock_booking set) and adds
 * nothing. While no event carries `tixstock_booking` the two sets are identical. "column ... does not exist"
 * = migration 20261110100000_tixstock_ticket_booking.sql is not applied.
 */
import { supabase } from "@/lib/supabase-server";

const PAGE = 1000;

/** The sync's own selection (type, not deleted, today or later), ids only, every page. */
async function selectedIds(withFilter: boolean, today: string): Promise<number[]> {
  const ids: number[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = supabase.from("events").select("id").eq("type", "tx_event").is("is_deleted", null);
    if (withFilter) query = query.or("tixstock_booking.is.null,is_test.is.false");
    const { data, error } = await query.gte("date", today).order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`events read failed (${withFilter ? "with" : "without"} the filter): ${error.message}`);
    const rows = (data ?? []) as { id: number }[];
    ids.push(...rows.map((r) => r.id));
    if (rows.length < PAGE) return ids;
  }
}

async function main(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const before = await selectedIds(false, today);
  const after = await selectedIds(true, today);
  const afterSet = new Set(after);
  const beforeSet = new Set(before);
  const dropped = before.filter((id) => !afterSet.has(id));
  const added = after.filter((id) => !beforeSet.has(id));

  console.log(`without the filter: ${before.length} events`);
  console.log(`with the filter:    ${after.length} events`);
  console.log(`same set: ${dropped.length === 0 && added.length === 0 ? "yes" : "no"}`);

  let bad = 0;
  if (added.length > 0) {
    bad++;
    console.log(`FAIL the filter ADDED ${added.length} event(s): ${added.join(", ")}`);
  }
  if (dropped.length > 0) {
    const { data, error } = await supabase.from("events").select("id, name, is_test, tixstock_booking").in("id", dropped);
    if (error) throw new Error(`dropped events read failed: ${error.message}`);
    const rows = (data ?? []) as { id: number; name: string | null; is_test: boolean; tixstock_booking: string | null }[];
    for (const r of rows) {
      const sandboxTest = r.is_test === true && r.tixstock_booking !== null;
      if (!sandboxTest) bad++;
      console.log(`${sandboxTest ? "ok  " : "FAIL"} dropped ${r.id} "${r.name ?? ""}" is_test=${r.is_test} tixstock_booking=${r.tixstock_booking}`);
    }
    if (rows.length !== dropped.length) {
      bad++;
      console.log(`FAIL ${dropped.length - rows.length} dropped event(s) could not be read back`);
    }
  }
  console.log(bad === 0 ? "tixstock-sync-selection-check: passed" : `tixstock-sync-selection-check: ${bad} problem(s)`);
  return bad === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
