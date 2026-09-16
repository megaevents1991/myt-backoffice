// scripts/gap-resolution-selftest.ts - `npx tsx scripts/gap-resolution-selftest.ts`
// Pure routing only: which gap family a task belongs to, whether a status change
// closes or reopens its gap, gap-key parsing, and the next-nightly cutoff time. The
// DB writes themselves (dismissCreativeGap, recordRepriced, base_price_sync_log
// flips) are verified in the browser - see task-15-report.md.
import { closedByTaskNote, gapAction, gapSourceOf, nextNightlyRun, parseGapKey } from "../lib/services/gap-resolution";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}

check("creative gap task", gapSourceOf("creative_gap"), "creative");
check("price light task", gapSourceOf("price_light"), "pricing");
check("price review task", gapSourceOf("price_review"), "pricing");
check("manual task has no gap", gapSourceOf("manual"), null);
check("roadmap task has no gap", gapSourceOf("roadmap"), null);
// A recurring task carries its domain in source_ref.kind, so it routes by ref, not by source.
check("recurring has no family by source alone", gapSourceOf("recurring"), null);

check("done closes", gapAction("done"), "close");
check("cancelled closes", gapAction("cancelled"), "close");
check("todo reopens", gapAction("todo"), "reopen");
check("in_progress reopens", gapAction("in_progress"), "reopen");
check("paused reopens", gapAction("paused"), "reopen");

// Key parsing - same shape RuleCandidate.key / openTaskGapKeys() produce.
check("key parses price_light package", parseGapKey("package:events:123"), { kind: "package", table: "events", rowId: 123 });
check("key parses price_light ticket", parseGapKey("ticket:events:45"), { kind: "ticket", table: "events", rowId: 45 });
check("key parses price_review", parseGapKey("price_review:events:9"), { kind: "price_review", table: "events", rowId: 9 });
check("malformed key - too few parts rejected", parseGapKey("package:events"), null);
check("malformed key - too many parts rejected", parseGapKey("package:events:123:extra"), null);
check("malformed key - non-numeric row rejected", parseGapKey("package:events:abc"), null);
check("malformed key - empty string rejected", parseGapKey(""), null);

// Close-by-task note format (controller ruling #1) - the exact string a price_review task's
// close writes, and the exact string a reopen must match to know a row is "its own" to undo.
check("closed-by-task note format", closedByTaskNote("abc-123"), "נסגר במשימה abc-123");
check("closed-by-task note format - different task", closedByTaskNote("xyz-999"), "נסגר במשימה xyz-999");
check("closed-by-task notes for different tasks are distinct",
  closedByTaskNote("task-a") === closedByTaskNote("task-b"), false);

// Next nightly run - 00:30 UTC, strictly after `now`.
check(
  "next nightly just before 00:30 UTC stays same day",
  nextNightlyRun(new Date("2026-09-16T00:29:00.000Z")).toISOString(),
  "2026-09-16T00:30:00.000Z",
);
check(
  "next nightly exactly at 00:30 UTC rolls to next day",
  nextNightlyRun(new Date("2026-09-16T00:30:00.000Z")).toISOString(),
  "2026-09-17T00:30:00.000Z",
);
check(
  "next nightly just after 00:30 UTC rolls to next day",
  nextNightlyRun(new Date("2026-09-16T00:31:00.000Z")).toISOString(),
  "2026-09-17T00:30:00.000Z",
);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
