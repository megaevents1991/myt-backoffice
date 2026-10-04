// scripts/reservation-follow-up-selftest.ts - `npx tsx scripts/reservation-follow-up-selftest.ts`
// The pure rules behind a reservation in "Follow-up" (lib/reservations/follow-up.ts): which
// status counts, what the call-back date means today, the date a status change leaves behind,
// and the order of the pile. The dashboard, the table and the morning mail are verified in
// the browser / with ?dry_run=1.
import {
  compareFollowUps,
  followUpCounts,
  followUpDateOnSave,
  followUpLabel,
  followUpState,
  isFollowUpDate,
  isFollowUpStatus,
  needsCallNow,
  nextWorkingDay,
} from "../lib/reservations/follow-up";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}

// 2026-10-04 is a Sunday.
const SUN = "2026-10-04";

// --- which status is the pile -------------------------------------------------------------
check("the status itself", isFollowUpStatus("Follow-up"), true);
check("typed by hand, lower case", isFollowUpStatus("follow-up"), true);
check("typed with a space", isFollowUpStatus("Follow up "), true);
check("typed as one word", isFollowUpStatus("FollowUp"), true);
check("Pending is not it", isFollowUpStatus("Pending"), false);
check("a longer status is not it", isFollowUpStatus("Follow-up done"), false);
check("no status", isFollowUpStatus(null), false);

// --- the date -----------------------------------------------------------------------------
check("a real day", isFollowUpDate("2026-10-05"), true);
check("a day that does not exist", isFollowUpDate("2026-02-30"), false);
check("a timestamp is not a day", isFollowUpDate("2026-10-05T08:00:00Z"), false);
check("empty", isFollowUpDate(""), false);
check("null", isFollowUpDate(null), false);

check("yesterday = overdue", followUpState("2026-10-03", SUN), "overdue");
check("today", followUpState(SUN, SUN), "today");
check("tomorrow = upcoming", followUpState("2026-10-05", SUN), "upcoming");
check("no date = undated", followUpState(null, SUN), "undated");
check("junk = undated", followUpState("soon", SUN), "undated");

check("overdue waits now", needsCallNow("overdue"), true);
check("today waits now", needsCallNow("today"), true);
check("nobody said when = waits now", needsCallNow("undated"), true);
check("a later day does not", needsCallNow("upcoming"), false);

// --- the default day: the next day the office works (Sunday-Thursday) ---------------------
check("Sunday -> Monday", nextWorkingDay("2026-10-04"), "2026-10-05");
check("Wednesday -> Thursday", nextWorkingDay("2026-10-07"), "2026-10-08");
check("Thursday -> Sunday", nextWorkingDay("2026-10-08"), "2026-10-11");
check("Friday -> Sunday", nextWorkingDay("2026-10-09"), "2026-10-11");
check("Saturday -> Sunday", nextWorkingDay("2026-10-10"), "2026-10-11");
check("across a month", nextWorkingDay("2026-10-29"), "2026-11-01");

// --- what a save does to the date (undefined = leave the column alone) ---------------------
check("entering with no date -> next working day",
  followUpDateOnSave({ prevStatus: "Pending", nextStatus: "Follow-up", current: null, today: SUN }), "2026-10-05");
check("entering with a picked date -> that date",
  followUpDateOnSave({ prevStatus: "Pending", nextStatus: "Follow-up", current: null, requested: "2026-10-12", today: SUN }), "2026-10-12");
check("entering, a future date is already stored -> kept",
  followUpDateOnSave({ prevStatus: "Pending", nextStatus: "Follow-up", current: "2026-10-09", today: SUN }), "2026-10-09");
check("entering, the stored date is from an older round -> next working day",
  followUpDateOnSave({ prevStatus: "Paid", nextStatus: "Follow-up", current: "2026-09-20", today: SUN }), "2026-10-05");
check("entering, the form sent that old date back untouched -> next working day",
  followUpDateOnSave({ prevStatus: "Paid", nextStatus: "Follow-up", current: "2026-09-20", requested: "2026-09-20", today: SUN }), "2026-10-05");
check("entering, staff picked a past day on purpose -> that day",
  followUpDateOnSave({ prevStatus: "Pending", nextStatus: "Follow-up", current: null, requested: "2026-10-01", today: SUN }), "2026-10-01");
check("staying, nothing sent -> alone",
  followUpDateOnSave({ prevStatus: "Follow-up", nextStatus: "Follow-up", current: "2026-10-01", today: SUN }), undefined);
check("staying, an overdue date sent back untouched -> stays overdue",
  followUpDateOnSave({ prevStatus: "Follow-up", nextStatus: "Follow-up", current: "2026-10-01", requested: "2026-10-01", today: SUN }), "2026-10-01");
check("staying, a new date",
  followUpDateOnSave({ prevStatus: "Follow-up", nextStatus: "Follow-up", current: "2026-10-01", requested: "2026-10-06", today: SUN }), "2026-10-06");
check("staying, emptied on purpose -> cleared",
  followUpDateOnSave({ prevStatus: "Follow-up", nextStatus: "Follow-up", current: "2026-10-01", requested: null, today: SUN }), null);
check("a save without a status (a comment) on a follow-up -> alone",
  followUpDateOnSave({ prevStatus: "Follow-up", nextStatus: undefined, current: "2026-10-01", today: SUN }), undefined);
check("a save without a status, only the date",
  followUpDateOnSave({ prevStatus: "Follow-up", nextStatus: undefined, current: "2026-10-01", requested: "2026-10-07", today: SUN }), "2026-10-07");
check("leaving, nothing sent -> alone",
  followUpDateOnSave({ prevStatus: "Follow-up", nextStatus: "Paid", current: "2026-10-01", today: SUN }), undefined);
check("leaving, the form sent the date back -> written as is",
  followUpDateOnSave({ prevStatus: "Follow-up", nextStatus: "Paid", current: "2026-10-01", requested: "2026-10-01", today: SUN }), "2026-10-01");
check("never in follow-up, junk sent -> null",
  followUpDateOnSave({ prevStatus: "Pending", nextStatus: "Paid", current: null, requested: "", today: SUN }), null);
check("never in follow-up, nothing sent -> alone",
  followUpDateOnSave({ prevStatus: "Pending", nextStatus: "Paid", current: null, today: SUN }), undefined);

// --- the order of the pile: longest overdue, today, nobody said when, then the nearest -----
const pile = [
  { id: 1, follow_up_date: "2026-10-08", created_at: "2026-09-01T10:00:00Z" },
  { id: 2, follow_up_date: null, created_at: "2026-10-02T10:00:00Z" },
  { id: 3, follow_up_date: "2026-10-04", created_at: "2026-10-03T10:00:00Z" },
  { id: 4, follow_up_date: "2026-10-02", created_at: "2026-10-01T10:00:00Z" },
  { id: 5, follow_up_date: "2026-09-28", created_at: "2026-10-01T12:00:00Z" },
  { id: 6, follow_up_date: null, created_at: "2026-10-01T09:00:00Z" },
  { id: 7, follow_up_date: "2026-10-05", created_at: "2026-10-04T10:00:00Z" },
];
check("pile order",
  [...pile].sort((a, b) => compareFollowUps(a, b, SUN)).map((r) => r.id), [5, 4, 3, 6, 2, 7, 1]);

check("counts", followUpCounts(pile, SUN), { total: 7, overdue: 2, today: 1, undated: 2, upcoming: 2, now: 5 });
check("an empty pile", followUpCounts([], SUN), { total: 0, overdue: 0, today: 0, undated: 0, upcoming: 0, now: 0 });

// --- what the row says ---------------------------------------------------------------------
check("label: one day late", followUpLabel("2026-10-03", SUN, "en"), "1 day late");
check("label: days late", followUpLabel("2026-09-28", SUN, "en"), "6 days late");
check("label: today", followUpLabel(SUN, SUN, "en"), "Today");
check("label: tomorrow", followUpLabel("2026-10-05", SUN, "en"), "Tomorrow");
check("label: later", followUpLabel("2026-10-08", SUN, "en"), "In 4 days");
check("label: no date", followUpLabel(null, SUN, "en"), "No date");
check("label he: one day late", followUpLabel("2026-10-03", SUN, "he"), "באיחור של יום");
check("label he: days late", followUpLabel("2026-09-28", SUN, "he"), "באיחור של 6 ימים");
check("label he: today", followUpLabel(SUN, SUN, "he"), "היום");
check("label he: tomorrow", followUpLabel("2026-10-05", SUN, "he"), "מחר");
check("label he: later", followUpLabel("2026-10-08", SUN, "he"), "בעוד 4 ימים");
check("label he: no date", followUpLabel(null, SUN, "he"), "בלי תאריך");

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
