// scripts/forms-report-selftest.ts - `npx tsx scripts/forms-report-selftest.ts`
// Pure helpers only (lib/forms/report.ts) - no DB, no session, no DOM.
// Synthetic trips: escort "Dana" leads three trips, "Avi" one; plus a response
// that came through no trip link at all.
import {
  buildEscortRows,
  buildTripReport,
  compareWithEscortPast,
  filterTrips,
  responsesOfTrips,
  summarizeTrips,
  tripFiltersFromQuery,
  tripFiltersToQuery,
} from "../lib/forms/report";
import type { ReportInvite, ReportResponse } from "../lib/forms/report";
import type { FormField } from "../types/form.types";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failed++;
    console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

function field(id: number, type: FormField["type"], staff = false): FormField {
  return {
    id,
    form_id: 1,
    type,
    position: id,
    label_en: `Q${id}`,
    label_he: null,
    help_en: null,
    help_he: null,
    placeholder_en: null,
    placeholder_he: null,
    required: false,
    staff_only: staff,
    options: [],
    config: {},
  };
}

// 1 = escort (staff), 2 = departure (staff), 3/4 = ratings, 5 = party size
const fields = [
  field(1, "short_text", true),
  field(2, "date", true),
  field(3, "rating"),
  field(4, "rating"),
  field(5, "number"),
];
const ratingFields = fields.filter((f) => f.type === "rating");
const staffFields = fields.filter((f) => f.staff_only);

function invite(id: number, code: string, escort: string, departure: string): ReportInvite {
  const [prefix, num] = code.split("-");
  return {
    id,
    trip_code_prefix: prefix,
    trip_code_num: num,
    total_travelers: null,
    prefill: { "1": escort, "2": departure },
    created_at: `${departure}T08:00:00Z`,
  };
}

const invites = [
  invite(10, "BBC-100", "Dana", "2025-03-01"),
  invite(11, "BBC-101", "  dana ", "2025-09-01"), // same escort, typed differently
  invite(12, "LON-200", "Dana", "2026-04-01"),
  invite(13, "LON-201", "Avi", "2026-05-01"),
];

function response(inviteId: number | null, q3: number, q4: number, party = 2): ReportResponse {
  return { invite_id: inviteId, answers: { "3": q3, "4": q4, "5": party }, submitted_at: "2026-01-01" };
}

const responses = [
  response(10, 4, 4),
  response(10, 2, 4),
  response(11, 5, 5),
  response(12, 3, 3),
  response(12, 5, 3),
  response(13, 5, 5),
  response(null, 1, 1), // shared link - the "no trip" bucket
];

const report = buildTripReport({
  ratingFields,
  staffFields,
  fields,
  invites,
  responses,
  labelFor: (f) => f.label_en,
});

// --- filterTrips -----------------------------------------------------------
check("no filter keeps every row + bucket", filterTrips(report.trips, {}).length, 5);
check(
  "escort filter ignores case and spaces",
  filterTrips(report.trips, { escort: "DANA" }).map((t) => t.code),
  ["LON-200", "BBC-101", "BBC-100"],
);
check(
  "year filter drops the bucket (no departure)",
  filterTrips(report.trips, { year: "2025" }).map((t) => t.code),
  ["BBC-101", "BBC-100"],
);
check(
  "departure range",
  filterTrips(report.trips, { fromDate: "2025-06-01", toDate: "2026-04-30" }).map((t) => t.code),
  ["LON-200", "BBC-101"],
);
check("prefix match", filterTrips(report.trips, { prefix: "lo" }).length, 2);
check("one trip", filterTrips(report.trips, { trip: 12 }).map((t) => t.code), ["LON-200"]);
check("the bucket alone", filterTrips(report.trips, { trip: "none" }).map((t) => t.inviteId), [null]);

// --- query round trip (the PDF link) ---------------------------------------
check(
  "filters -> query",
  tripFiltersToQuery({ prefix: "BBC", escort: "דנה", year: "all", fromDate: "", trip: null }),
  "prefix=BBC&escort=%D7%93%D7%A0%D7%94",
);
check("one trip -> query", tripFiltersToQuery({ trip: 12 }), "trip=12");
check(
  "query -> filters",
  tripFiltersFromQuery({ escort: "דנה", year: "2025", fromDate: "2025-01-01", toDate: "bad", trip: "none" }),
  {
    escort: "דנה",
    fromDate: "2025-01-01",
    year: "2025",
    trip: "none",
  },
);
check("query -> trip id", tripFiltersFromQuery({ trip: "12" }).trip, 12);
check("query -> junk trip dropped", tripFiltersFromQuery({ trip: "x" }).trip, null);

// --- responsesOfTrips + summarizeTrips -------------------------------------
const y2025 = filterTrips(report.trips, { year: "2025" });
const scoped = responsesOfTrips(responses, y2025, report.trips);
check("responses of 2025 trips", scoped.length, 3);
check(
  "bucket row stands for the no-trip responses",
  responsesOfTrips(responses, filterTrips(report.trips, { trip: "none" }), report.trips).length,
  1,
);
const summary = summarizeTrips(y2025, scoped, ratingFields);
check("2025 trip count", summary.tripCount, 2);
check("2025 response count", summary.responseCount, 3);
// ratings 4,4,2,4,5,5 -> 24/6 = 4
check("2025 flat average", summary.overallAvg, 4);
check("2025 per question", summary.perField.map((f) => f.avg), [3.67, 4.33]);
check("2025 travellers reported", summary.travelers?.reported, 6);

// --- buildEscortRows ---------------------------------------------------------
const escorts = buildEscortRows(report.trips, responses, ratingFields);
check("one row per escort, busiest first", escorts.map((e) => [e.name, e.trips.length]), [
  ["Dana", 3],
  ["Avi", 1],
]);
const dana = escorts[0];
check("escort trips oldest first", dana.trips.map((t) => t.code), ["BBC-100", "BBC-101", "LON-200"]);
check("escort first/last departure", [dana.firstDeparture, dana.lastDeparture], ["2025-03-01", "2026-04-01"]);
check("escort responses", dana.responseCount, 5);
// ratings 4,4,2,4,5,5,3,3,5,3 -> 38/10
check("escort flat average", dana.overallAvg, 3.8);
// last trip 3.5 vs earlier (4,4,2,4,5,5 -> 4) = -0.5
check("escort trend = last trip vs earlier trips", dana.trend, -0.5);
check("single-trip escort has no trend", escorts[1].trend, null);
check(
  "escort rows follow the filter",
  buildEscortRows(filterTrips(report.trips, { year: "2026" }), responses, ratingFields).map(
    (e) => [e.name, e.trips.length],
  ),
  [
    ["Avi", 1],
    ["Dana", 1],
  ],
);

// --- compareWithEscortPast ---------------------------------------------------
const lon200 = report.trips.find((t) => t.code === "LON-200");
const cmp = lon200 ? compareWithEscortPast(lon200, report.trips, responses, ratingFields) : null;
check("compared with both earlier trips", cmp?.pastTrips.map((t) => t.code), ["BBC-100", "BBC-101"]);
check("past responses", cmp?.pastResponses, 3);
check("current vs past overall", [cmp?.current, cmp?.past, cmp?.delta], [3.5, 4, -0.5]);
// q3: now (3+5)/2 = 4 vs past (4+2+5)/3 = 3.67; q4: 3 vs 4.33
check(
  "per question deltas",
  cmp?.perField.map((f) => [f.current, f.past, f.delta]),
  [
    [4, 3.67, 0.33],
    [3, 4.33, -1.33],
  ],
);
// every other response: q3 4,2,5,5,1 / q4 4,4,5,5,1 -> 36/10
check("house average excludes this trip", cmp?.others, 3.6);
const first = report.trips.find((t) => t.code === "BBC-100");
check(
  "an escort's first trip has nothing to compare",
  first ? compareWithEscortPast(first, report.trips, responses, ratingFields) : "missing",
  null,
);
const bucket = report.trips.find((t) => t.inviteId === null);
check(
  "the bucket has no escort",
  bucket ? compareWithEscortPast(bucket, report.trips, responses, ratingFields) : "missing",
  null,
);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall forms report checks passed");
