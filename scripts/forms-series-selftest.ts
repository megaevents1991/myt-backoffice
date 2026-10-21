// scripts/forms-series-selftest.ts - `npx tsx scripts/forms-series-selftest.ts`
// Pure rules of the series forms + hotel questions (lib/forms/series.ts) - no DB, no session.
// Synthetic data: two series (BBC, FPAR) sleeping in the same London hotel spelled two ways.
import {
  buildHotelRows,
  departureTripCode,
  hotelKey,
  hotelOf,
  hotelQuestionLabel,
  hotelSnapshots,
  normalizeHotelConfig,
  onFive,
  orderDepartures,
  snapshotsOf,
  type HotelAnswer,
} from "../lib/forms/series";
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

function field(id: number, type: FormField["type"], config: FormField["config"] = {}, staff = false): FormField {
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
    config,
  };
}

// ---------------------------------------------------------------- hotel config
check("empty config is no hotel", normalizeHotelConfig({ city_he: " ", name: "" }), undefined);
check("not an object", normalizeHotelConfig("London"), undefined);
check(
  "trimmed, spaces collapsed, numbers dropped",
  normalizeHotelConfig({ city_he: "  לונדון ", city_en: 5, name: "Double  Tree " }),
  { city_he: "לונדון", city_en: null, name: "Double Tree" },
);
check(
  "capped at 120 chars",
  normalizeHotelConfig({ city_he: "x", name: "a".repeat(300) })?.name.length,
  120,
);

const london = field(10, "rating", { max: 5, hotel: { city_he: "לונדון", city_en: "London", name: "DoubleTree" } });
const paris = field(11, "rating", { max: 5, hotel: { city_he: "פריז", name: "Le Marceau" } });
const plain = field(12, "rating", { max: 5 });
const textWithHotel = field(13, "short_text", { hotel: { city_he: "רומא", name: "X" } });
check("rating with hotel", hotelOf(london)?.name, "DoubleTree");
check("plain rating is no hotel", hotelOf(plain), null);
check("only a rating can be a hotel question", hotelOf(textWithHotel), null);

check("Hebrew wording", hotelQuestionLabel("לונדון", "he"), "איך היה המלון בלונדון?");
check("English wording", hotelQuestionLabel(" London ", "en"), "How was the hotel in London?");
check("no city yet", hotelQuestionLabel("", "he"), "איך היה המלון?");

// ---------------------------------------------------------------- snapshot
check(
  "only answered hotel questions are snapshotted",
  hotelSnapshots([london, paris, plain, field(14, "rating", { hotel: { city_he: "a", name: "b" } }, true)], {
    "10": 4,
    "11": null,
    "12": 5,
    "14": 3,
  }),
  { "10": { city: "לונדון", name: "DoubleTree" } },
);
check("snapshot read back", snapshotsOf({ hotels: { "10": { city: "לונדון", name: "DoubleTree" } } }), {
  "10": { city: "לונדון", name: "DoubleTree" },
});
check("malformed context reads as none", snapshotsOf({ hotels: [1, 2] }), {});
check("null context reads as none", snapshotsOf(null), {});

// ---------------------------------------------------------------- hotel key
check(
  "one hotel however it is spelled",
  hotelKey(" לונדון", "DoubleTree - by Hilton") === hotelKey("לונדון ", "doubletree  by hilton"),
  true,
);
check("accents ignored", hotelKey("Paris", "Hôtel Napoléon") === hotelKey("paris", "Hotel Napoleon"), true);
check("another city is another hotel", hotelKey("לונדון", "Ibis") === hotelKey("פריז", "Ibis"), false);

// ---------------------------------------------------------------- departures
check(
  "code carries the number",
  departureTripCode({ code: "BBC703", start_date: "2026-07-03", series_code: "BBC" }),
  { prefix: "BBC", num: "703" },
);
check(
  "October keeps two digits of month",
  departureTripCode({ code: "CBEA1014", start_date: "2026-10-14", series_code: "cbea" }),
  { prefix: "CBEA", num: "1014" },
);
check(
  "a code without a number falls back to month + day",
  departureTripCode({ code: "SPECIAL", start_date: "2026-09-23", series_code: "BBC" }),
  { prefix: "BBC", num: "923" },
);
check(
  "a series code that is not letters cannot make a trip code",
  departureTripCode({ code: "B2C703", start_date: "2026-07-03", series_code: "B2C" }),
  null,
);

const deps = [
  { code: "BBC1201", start_date: "2026-12-01" },
  { code: "BBC703", start_date: "2026-07-03" },
  { code: "BBC1014", start_date: "2026-10-14" },
  { code: "BBC1020", start_date: "2026-10-20" },
  { code: "BBC1105", start_date: "2026-11-05" },
];
check(
  "left ones newest first, then coming ones soonest first",
  orderDepartures(deps, "2026-10-21").map((d) => d.code),
  ["BBC1020", "BBC1014", "BBC703", "BBC1105", "BBC1201"],
);
check("today counts as left", orderDepartures(deps, "2026-10-20")[0].code, "BBC1020");

// ---------------------------------------------------------------- hotels report
check("5 of 5 is 5", onFive(5, 5), 5);
check("8 of 10 is 4", onFive(8, 10), 4);

const answer = (over: Partial<HotelAnswer>): HotelAnswer => ({
  formId: 1,
  fieldId: 10,
  value: 5,
  max: 5,
  city: "לונדון",
  name: "DoubleTree",
  tripCode: "BBC-703",
  inviteId: 1,
  series: "BBC",
  submittedAt: "2026-07-10T10:00:00Z",
  ...over,
});
const rows = buildHotelRows([
  answer({ value: 2 }),
  answer({ value: 3 }),
  // The same hotel on another series, spelled another way, newer - it names the row.
  answer({ formId: 2, fieldId: 20, value: 4, name: "Double Tree", tripCode: "FPAR-930", inviteId: 2, series: "FPAR", submittedAt: "2026-09-30T10:00:00Z" }),
  answer({ formId: 2, fieldId: 21, value: 5, city: "פריז", name: "Le Marceau", tripCode: "FPAR-930", inviteId: 2, series: "FPAR" }),
  answer({ formId: 2, fieldId: 21, value: 10, max: 10, city: "פריז", name: "Le Marceau", tripCode: null, inviteId: null, series: "FPAR" }),
]);
check("two hotels", rows.length, 2);
check("weakest first", rows.map((r) => r.city), ["לונדון", "פריז"]);
check("London mean over both series", rows[0].avg, 3);
check("London answers", rows[0].answers, 3);
check("London series", rows[0].series, ["BBC", "FPAR"]);
check("London trips", rows[0].trips, 2);
check("London named as spelled last", rows[0].name, "Double Tree");
check("weakest trip of London", rows[0].worstTrip, { code: "BBC-703", avg: 2.5, answers: 2 });
check("star spread", rows[0].spread, [0, 1, 1, 1, 0]);
check("a 10-star answer counts on five", rows[1].avg, 5);
check("an answer with no trip link counts, but is no trip", rows[1].trips, 1);
check("forms", rows[0].forms, [1, 2]);
check("no answers, no rows", buildHotelRows([]), []);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall forms series checks passed");
