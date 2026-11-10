/**
 * Read-only check for the partner portal's event lists (the "what's new" rail and its top-up in
 * portal-dashboard-actions.ts, the package builder's list in portal-package-actions.ts, the quote form's list in
 * quote-actions.ts). All four select `is_deleted is null`, `is_hidden = false` and a date from today on; this
 * script runs that widest selection without and with `is_test = false`. Reads PRODUCTION (.env.local), writes
 * nothing.
 *
 *   npx tsx --env-file=.env.local scripts/portal-test-events-check.ts
 *
 * It prints the test events a partner is offered without the filter, and passes when the filter drops exactly
 * those and no real event.
 */
import { supabase } from "@/lib/supabase-server";

const PAGE = 1000;

type Row = { id: number; name: string | null; date: string | null; is_test: boolean; tixstock_booking: string | null };

async function offered(withFilter: boolean, today: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = supabase.from("events").select("id, name, date, is_test, tixstock_booking").is("is_deleted", null).eq("is_hidden", false);
    if (withFilter) query = query.eq("is_test", false);
    const { data, error } = await query.gte("date", today).order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`events read failed (${withFilter ? "with" : "without"} the filter): ${error.message}`);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

async function main(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const before = await offered(false, today);
  const after = await offered(true, today);
  const afterIds = new Set(after.map((r) => r.id));
  const beforeIds = new Set(before.map((r) => r.id));
  const dropped = before.filter((r) => !afterIds.has(r.id));
  const tests = before.filter((r) => r.is_test === true);

  console.log(`offered to a partner without the filter: ${before.length} events, ${tests.length} of them test events`);
  for (const r of tests) console.log(`  test event ${r.id} "${r.name ?? ""}" ${String(r.date).slice(0, 10)} tixstock_booking=${r.tixstock_booking}`);
  console.log(`offered with the filter: ${after.length} events`);

  let bad = 0;
  const realDropped = dropped.filter((r) => r.is_test !== true);
  if (realDropped.length > 0) {
    bad++;
    console.log(`FAIL the filter drops ${realDropped.length} REAL event(s): ${realDropped.map((r) => r.id).join(", ")}`);
  }
  const testsLeft = after.filter((r) => r.is_test === true);
  if (testsLeft.length > 0) {
    bad++;
    console.log(`FAIL ${testsLeft.length} test event(s) still offered: ${testsLeft.map((r) => r.id).join(", ")}`);
  }
  const added = after.filter((r) => !beforeIds.has(r.id));
  if (added.length > 0) {
    bad++;
    console.log(`FAIL the filter ADDED ${added.length} event(s): ${added.map((r) => r.id).join(", ")}`);
  }
  if (dropped.length !== tests.length) {
    bad++;
    console.log(`FAIL dropped ${dropped.length} event(s) but ${tests.length} are test events`);
  }
  console.log(bad === 0 ? "portal-test-events-check: passed" : `portal-test-events-check: ${bad} problem(s)`);
  return bad === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
