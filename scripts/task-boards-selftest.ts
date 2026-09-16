// scripts/task-boards-selftest.ts - `npx tsx scripts/task-boards-selftest.ts`
// Pure: no DB, no network. Same pattern as scripts/price-light-selftest.ts.
import { BOARD_META, CHANNEL_META, PHASES, validBoard, validChannel, validPhase, validProgress } from "../lib/task-boards";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}

check("board valid", validBoard("dev"), true);
check("board invalid", validBoard("engineering"), false);
check("phase 1..7", [validPhase(1), validPhase(7), validPhase(0), validPhase(8), validPhase(null)], [true, true, false, false, true]);
check("channel", [validChannel("seo"), validChannel("tiktok")], [true, false]);
check("progress bounds", [validProgress(0), validProgress(100), validProgress(101), validProgress(-1)], [true, true, false, false]);
check("every phase has a label", Object.keys(PHASES).length, 7);
check("every channel has a label", Object.keys(CHANNEL_META).length, 7);
check("every board has a label", Object.keys(BOARD_META).length, 3);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
