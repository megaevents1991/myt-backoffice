import { redSinceUpdate } from "../lib/services/price-light-red-since";

const NOW = "2026-09-16T00:00:00.000Z";
const OLD = "2026-09-01T00:00:00.000Z";
let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}

check("enters red", redSinceUpdate({ package: "orange", ticket: null }, { package: "red", ticket: null }, null, NOW), { light_red_since: NOW });
check("stays red", redSinceUpdate({ package: "red", ticket: null }, { package: "red", ticket: null }, OLD, NOW), null);
check("second scope reds", redSinceUpdate({ package: "red", ticket: "green" }, { package: "red", ticket: "red" }, OLD, NOW), null);
check("leaves red", redSinceUpdate({ package: "red", ticket: null }, { package: "orange", ticket: null }, OLD, NOW), { light_red_since: null });
check("quiet", redSinceUpdate({ package: "green", ticket: "green" }, { package: "green", ticket: "green" }, null, NOW), null);
check("re-reds", redSinceUpdate({ package: "green", ticket: null }, { package: "red", ticket: null }, null, NOW), { light_red_since: NOW });
// Rows that were already red before the column existed get stamped, not left blank.
check("backfills missing stamp", redSinceUpdate({ package: "red", ticket: null }, { package: "red", ticket: null }, null, NOW), { light_red_since: NOW });

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
