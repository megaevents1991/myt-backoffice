// scripts/task-rules-selftest.ts - `npx tsx scripts/task-rules-selftest.ts`
// Pure only: week maths and the price-light filter, fed synthetic rows.
import { isoWeek, weeksSince } from "../lib/services/task-rules/week";
import { filterLightCandidates } from "../lib/services/task-rules/price-light";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}

check("iso week", isoWeek(new Date("2026-09-16T00:00:00Z")), "2026-W38");
check("iso week rolls at monday", isoWeek(new Date("2026-09-21T00:00:00Z")), "2026-W39");
check("weeks since null", weeksSince(null, new Date("2026-09-16T00:00:00Z")), null);
check("weeks since 15 days", weeksSince("2026-09-01T00:00:00Z", new Date("2026-09-16T00:00:00Z")), 2);

const rows = [
  { id: 1, name: "A", light_package: "red", light_ticket: null, light_red_since: "2026-09-01T00:00:00Z", vertical: "football", gap_usd: 200, silenced: false },
  { id: 2, name: "B", light_package: "red", light_ticket: null, light_red_since: "2026-09-14T00:00:00Z", vertical: "football", gap_usd: 200, silenced: false },
  { id: 3, name: "C", light_package: "orange", light_ticket: null, light_red_since: null, vertical: "football", gap_usd: 900, silenced: false },
  { id: 4, name: "D", light_package: "red", light_ticket: null, light_red_since: "2026-09-01T00:00:00Z", vertical: "music", gap_usd: 200, silenced: false },
  { id: 5, name: "E", light_package: "red", light_ticket: null, light_red_since: "2026-09-01T00:00:00Z", vertical: "football", gap_usd: 20, silenced: false },
  { id: 6, name: "F", light_package: "red", light_ticket: null, light_red_since: "2026-09-01T00:00:00Z", vertical: "football", gap_usd: 200, silenced: true },
  { id: 7, name: "G", light_package: "red", light_ticket: null, light_red_since: null, vertical: "football", gap_usd: 200, silenced: false },
];
const now = new Date("2026-09-16T00:00:00Z");

check("no filter = every unsilenced red", filterLightCandidates(rows, {}, now).map((r) => r.id), [1, 2, 4, 5, 7]);
check("vertical", filterLightCandidates(rows, { vertical: "football" }, now).map((r) => r.id), [1, 2, 5, 7]);
check("min gap", filterLightCandidates(rows, { min_gap_usd: 150 }, now).map((r) => r.id), [1, 2, 4, 7]);
// min_weeks_red drops the 2-day-old red AND the unknown one (null = not proven).
check("min weeks red", filterLightCandidates(rows, { min_weeks_red: 2 }, now).map((r) => r.id), [1, 4, 5]);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
