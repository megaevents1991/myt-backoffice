/**
 * Tour uploader (agent #3) selftest - the pure modules under lib/uploader/.
 * No DB and no API call: every input here is synthetic. Spec:
 * docs/superpowers/specs/2026-10-21-tour-uploader-agent-design.md.
 *
 * Run: npx tsx scripts/tour-uploader-selftest.ts
 * (tsx rather than plain node: the modules resolve `@/` paths from tsconfig.)
 *
 * One independent section per module. A later task adds its section ABOVE the summary line at the
 * bottom - `check` / `same` / `problemFor` count themselves, so the summary never needs editing.
 */
import assert from "node:assert/strict";
import {
  BOARD_POLL_MS,
  FAR_VENUE_KM,
  LIST_MAX,
  MARKUP_MAX,
  NAME_MAX,
  NEAR_LOCATION_KM,
  REJECT_REASON_MIN,
  SHOW_WINDOW_DAYS,
  TOAST_POLL_MS,
} from "@/lib/uploader/constants";
import {
  applyPriorDefaults,
  emptyPlan,
  parsePlanInput,
  PLAN_TOOL_SCHEMA,
  planDiff,
  type PlanParse,
} from "@/lib/uploader/plan";
import {
  buildDuplicateFor,
  calendarDay,
  carriesSplitAnswer,
  existingEventFor,
  ownEventToClean,
  groupRows,
  liveMatchesSubject,
  priorAnswerFor,
  priorItemsOf,
  priorRejectionFor,
  priorRunScope,
  questionKey,
  showKey,
  tixMatchesSubject,
  type ExistingEvent,
  type LiveRow,
  type PriorItem,
  type Subject,
  type TixRow,
} from "@/lib/uploader/shows";
import {
  SUPPLIER_TICKET_COLOR,
  ticketsFromLiveStock,
  ticketsFromTixStockFeed,
  type TixListing,
} from "@/lib/uploader/tickets";
import { DECISION_TEXT, decision, EDIT_WHITELIST, editDiff } from "@/lib/uploader/decisions";
import { eventNames, withSupplierSpellings } from "@/lib/uploader/names";
import { farVenueOffer, WARNING_TEXT, warningsFor, type BuildFacts, type SubjectRows } from "@/lib/uploader/warnings";
import { calculateSmartDates } from "@/lib/smart-dates";
import { zoneFromTemplate } from "@/lib/venue-maps/zone-from-template";
import { findNearestLocation, type LocationRow } from "@/lib/services/nearest-location";
import { nameFragments, searchWindow, subjectPatterns, tixSlices } from "@/lib/services/uploader-search";
import { decidePlace, locationFromAnswer, SPLIT_DEFAULT_NIGHTS, venueCity, type PlaceInput } from "@/lib/uploader/place";
import type { LiveTicketsCategory, LiveTicketsStock } from "@/lib/services/livetickets-offers";
import type { SupplierCurrency } from "@/lib/suppliers";
import { PRICED_PARTY } from "@/lib/tixstock-listings";
import type { EventTicket } from "@/types/app.types";
import type { ShowIdentity, UploaderPlan, UploaderQuestion } from "@/types/uploader.types";
import * as runRules from "@/lib/uploader/run-rules";

let checks = 0;
/** A truthy check. */
const check = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
};
/** A deep-equal check (assert/strict - structure and types, key order ignored). */
const same = (actual: unknown, expected: unknown, msg: string): void => {
  assert.deepEqual(actual, expected, msg);
  checks++;
};
/** The problems of a failed parse; throws (= a failed check) when the parse said ok. */
const problemsOf = (r: PlanParse): string[] => {
  assert.equal(r.ok, false, "expected the parse to report a problem");
  return r.problems;
};
/** Exactly one problem and it names `field` (the dotted path starts the line). */
const problemFor = (r: PlanParse, field: string, msg: string): void => {
  const problems = problemsOf(r);
  assert.equal(problems.length, 1, `${msg}: ${JSON.stringify(problems)}`);
  assert.ok(problems[0].startsWith(`${field}:`), `${msg}: "${problems[0]}" should name ${field}`);
  checks++;
};

/** The plan the parser should hand back for "Eric Clapton, May 2027, packages only where a location exists". */
const clapton = (): UploaderPlan => ({
  subject: { kind: "artist", name_he: "אריק קלפטון", name_en: "Eric Clapton" },
  scope: {
    date_from: "2027-05-01",
    date_to: "2027-06-30",
    home_only: true,
    round: null,
    exclude_cities: ["Skokie"],
    include_cities: [],
  },
  rules: { with_location: "package", without_location: "ticket_only" },
  markups: { ticket_only: 200, additional: null },
  suppliers: ["tixstock", "livetickets"],
  notes: ["no hotel in Zurich"],
});

// ---- constants ------------------------------------------------------------------------------
same(
  [NEAR_LOCATION_KM, FAR_VENUE_KM, SHOW_WINDOW_DAYS, REJECT_REASON_MIN, TOAST_POLL_MS, BOARD_POLL_MS],
  [50, 300, 3, 3, 60_000, 2_500],
  "the spec's tuning constants",
);
same([MARKUP_MAX, NAME_MAX, LIST_MAX], [5000, 120, 20], "the plan's validation bounds");
same(PRICED_PARTY, 2, "the priced party is the TixStock sync's own constant (lib/tixstock-listings)");

// ---- lib/uploader/plan.ts: emptyPlan ---------------------------------------------------------
{
  const e = emptyPlan();
  same(
    e,
    {
      subject: { kind: "artist", name_he: null, name_en: "" },
      scope: { date_from: null, date_to: null, home_only: true, round: null, exclude_cities: [], include_cities: [] },
      rules: { with_location: "package", without_location: "skip" },
      markups: { ticket_only: null, additional: null },
      suppliers: ["tixstock", "livetickets"],
      notes: [],
    },
    "emptyPlan: artist, skip without a location, nulls, both suppliers",
  );
  e.notes.push("x");
  e.scope.exclude_cities.push("y");
  same(emptyPlan().notes, [], "emptyPlan hands out a fresh object each call (no shared arrays)");
  same(emptyPlan().scope.exclude_cities, [], "emptyPlan: fresh scope arrays too");
}

// ---- lib/uploader/plan.ts: PLAN_TOOL_SCHEMA --------------------------------------------------
{
  const s = PLAN_TOOL_SCHEMA as {
    type: string;
    required: string[];
    properties: Record<string, { type?: unknown; properties?: Record<string, unknown>; required?: string[]; enum?: unknown }>;
  };
  same(s.type, "object", "schema: a tool input is an object");
  same(
    [...s.required].sort(),
    ["markups", "notes", "rules", "scope", "subject", "suppliers"],
    "schema: every top-level key is required (suppliers and notes included)",
  );
  same(Object.keys(s.properties).sort(), Object.keys(emptyPlan()).sort(), "schema: same top-level keys as the plan");
  for (const group of ["subject", "scope", "rules", "markups"] as const) {
    same(
      Object.keys(s.properties[group].properties ?? {}).sort(),
      Object.keys(emptyPlan()[group]).sort(),
      `schema: ${group} has the plan's keys, no more and no fewer`,
    );
  }
  same(
    (s.properties.subject.properties?.kind as { enum: string[] }).enum,
    ["artist", "team", "competition"],
    "schema: subject.kind is the three kinds",
  );
  same(
    (s.properties.markups.properties?.ticket_only as { type: string[]; maximum: number }).type,
    ["integer", "null"],
    "schema: a markup is an integer or null",
  );
  same(
    (s.properties.markups.properties?.ticket_only as { type: string[]; maximum: number }).maximum,
    MARKUP_MAX,
    "schema: markup ceiling is MARKUP_MAX",
  );
  same(
    (s.properties.suppliers as { minItems?: number; maxItems?: number }).maxItems,
    2,
    "schema: suppliers is a fixed pair",
  );
}

// ---- lib/uploader/plan.ts: parsePlanInput - the accepted plan --------------------------------
{
  const r = parsePlanInput(clapton());
  check(r.ok, "the Clapton plan is accepted verbatim");
  same(r.plan, clapton(), "the Clapton plan comes back unchanged");
  same(r.problems, [], "an accepted plan has no problems");
  // JSON round trip (what a tool call really delivers) is accepted too
  const viaJson = parsePlanInput(JSON.parse(JSON.stringify(clapton())));
  check(viaJson.ok, "a JSON round-tripped plan is accepted");
  same(viaJson.plan, clapton(), "and unchanged");
  // the input object is never mutated or aliased
  const input = clapton();
  const out = parsePlanInput(input).plan;
  out.scope.exclude_cities.push("Zurich");
  same(input.scope.exclude_cities, ["Skokie"], "the parse hands back its own arrays");
}

// ---- lib/uploader/plan.ts: parsePlanInput - markups ------------------------------------------
for (const bad of [250.5, -1, 99999, "75", Number.NaN, Number.POSITIVE_INFINITY, true]) {
  const input = clapton();
  (input.markups as { ticket_only: unknown }).ticket_only = bad;
  input.markups.additional = 75;
  const r = parsePlanInput(input);
  problemFor(r, "markups.ticket_only", `markups.ticket_only ${String(bad)}`);
  same(r.plan.markups, { ticket_only: null, additional: 75 }, `a bad ${String(bad)} falls back to null, the other markup stays`);
  same(r.plan.subject, clapton().subject, "the rest of the plan is kept");
  same(r.plan.scope, clapton().scope, "the scope too");
}
for (const good of [0, 1, 5000, 75]) {
  const input = clapton();
  input.markups.additional = good;
  const r = parsePlanInput(input);
  check(r.ok, `additional ${good} is a valid markup`);
  same(r.plan.markups.additional, good, `additional ${good} kept`);
}
{
  const input = clapton();
  (input as { markups?: unknown }).markups = undefined;
  const r = parsePlanInput(input);
  check(r.ok, "a missing markups block is two nulls, not a problem");
  same(r.plan.markups, { ticket_only: null, additional: null }, "missing markups = nulls");
  (input as { markups?: unknown }).markups = "cheap";
  problemFor(parsePlanInput(input), "markups", "markups that is not an object");
}

// ---- lib/uploader/plan.ts: parsePlanInput - subject ------------------------------------------
{
  const input = clapton();
  (input.subject as { kind: unknown }).kind = "band";
  const r = parsePlanInput(input);
  problemFor(r, "subject.kind", 'kind "band"');
  same(r.plan.subject, { kind: "artist", name_he: "אריק קלפטון", name_en: "Eric Clapton" }, "a bad kind falls back to artist, names stay");
  same(r.plan.markups, clapton().markups, "and the markups stay");
}
for (const kind of ["artist", "team", "competition"] as const) {
  const input = clapton();
  input.subject.kind = kind;
  check(parsePlanInput(input).ok, `kind ${kind} is valid`);
}
{
  const input = clapton();
  input.subject.name_en = "x".repeat(NAME_MAX + 1);
  const r = parsePlanInput(input);
  problemFor(r, "subject.name_en", "name_en over NAME_MAX");
  same(r.plan.subject.name_en, "", "a too-long name falls back to the empty plan's value");
  same(r.plan.subject.name_he, "אריק קלפטון", "the Hebrew name stays");
  input.subject.name_en = "x".repeat(NAME_MAX);
  check(parsePlanInput(input).ok, "name_en of exactly NAME_MAX is fine");
  input.subject.name_en = `   ${"y".repeat(NAME_MAX)}   `;
  const trimmed = parsePlanInput(input);
  check(trimmed.ok, "spaces around a NAME_MAX name do not count");
  same(trimmed.plan.subject.name_en, "y".repeat(NAME_MAX), "names are trimmed");
}
for (const empty of ["", "   ", null, undefined, 7]) {
  const input = clapton();
  (input.subject as { name_en: unknown }).name_en = empty;
  problemFor(parsePlanInput(input), "subject.name_en", `name_en ${JSON.stringify(empty)} is required`);
}
{
  const input = clapton();
  input.subject.name_he = "x".repeat(NAME_MAX + 1);
  const r = parsePlanInput(input);
  problemFor(r, "subject.name_he", "name_he over NAME_MAX");
  same(r.plan.subject.name_he, null, "a too-long Hebrew name falls back to null");
  input.subject.name_he = "   ";
  const blank = parsePlanInput(input);
  check(blank.ok, "a blank Hebrew name is just 'none'");
  same(blank.plan.subject.name_he, null, "blank Hebrew name = null");
  (input.subject as { name_he: unknown }).name_he = 12;
  problemFor(parsePlanInput(input), "subject.name_he", "a non-string Hebrew name");
}
{
  const input = clapton();
  (input as { subject?: unknown }).subject = undefined;
  const r = parsePlanInput(input);
  same(
    problemsOf(r).map((p) => p.split(":")[0]),
    ["subject.kind", "subject.name_en"],
    "a missing subject block names the two things it was for: the kind and the name",
  );
  same(r.plan.markups, clapton().markups, "and the other blocks are kept");
  const noKind = clapton();
  (noKind.subject as { kind?: unknown }).kind = undefined;
  problemFor(parsePlanInput(noKind), "subject.kind", "a missing kind is not guessed");
}

// ---- lib/uploader/plan.ts: parsePlanInput - scope --------------------------------------------
{
  const input = clapton();
  input.scope.date_from = "21/05/2027";
  const r = parsePlanInput(input);
  problemFor(r, "scope.date_from", "date_from 21/05/2027");
  same(r.plan.scope.date_from, null, "a bad date falls back to null");
  same(r.plan.scope.date_to, "2027-06-30", "the other date stays");
  input.scope.date_from = "2027-05-01";
  (input.scope as { date_to: unknown }).date_to = "2027-6-30";
  problemFor(parsePlanInput(input), "scope.date_to", "a date with a one-digit month");
  (input.scope as { date_to: unknown }).date_to = 20270630;
  problemFor(parsePlanInput(input), "scope.date_to", "a date that is a number");
  input.scope.date_to = null;
  check(parsePlanInput(input).ok, "null dates are fine (open window)");
}
{
  const input = clapton();
  (input.scope as { home_only: unknown }).home_only = undefined;
  const r = parsePlanInput(input);
  check(r.ok, "a missing home_only is not a problem");
  same(r.plan.scope.home_only, true, "home_only defaults to true");
  input.scope.home_only = false;
  same(parsePlanInput(input).plan.scope.home_only, false, "an explicit false is kept");
  (input.scope as { home_only: unknown }).home_only = "no";
  const bad = parsePlanInput(input);
  problemFor(bad, "scope.home_only", "home_only that is not a boolean");
  same(bad.plan.scope.home_only, true, "a bad home_only falls back to true");
}
{
  const input = clapton();
  input.scope.round = "  Round of 16  ";
  same(parsePlanInput(input).plan.scope.round, "Round of 16", "round is trimmed");
  input.scope.round = "   ";
  same(parsePlanInput(input).plan.scope.round, null, "a blank round is null");
  input.scope.round = "r".repeat(NAME_MAX + 1);
  problemFor(parsePlanInput(input), "scope.round", "a round over NAME_MAX");
}
{
  const input = clapton();
  (input.scope as { exclude_cities: unknown }).exclude_cities = ["  London ", 7, null, "", "  ", "Paris", { a: 1 }];
  const r = parsePlanInput(input);
  check(r.ok, "non-strings in a list are dropped quietly");
  same(r.plan.scope.exclude_cities, ["London", "Paris"], "list entries are trimmed, blanks and non-strings dropped");
  input.scope.exclude_cities = Array.from({ length: LIST_MAX }, (_, i) => `City ${i}`);
  check(parsePlanInput(input).ok, "exactly LIST_MAX entries is fine");
  input.scope.exclude_cities = Array.from({ length: LIST_MAX + 1 }, (_, i) => `City ${i}`);
  const tooMany = parsePlanInput(input);
  problemFor(tooMany, "scope.exclude_cities", "more than LIST_MAX cities");
  same(tooMany.plan.scope.exclude_cities, [], "an oversized list falls back to the empty plan's value");
  (input.scope as { exclude_cities: unknown }).exclude_cities = "London";
  problemFor(parsePlanInput(input), "scope.exclude_cities", "a list that is a string");
  (input.scope as { include_cities: unknown }).include_cities = { 0: "Milan" };
  const twoBad = parsePlanInput(input);
  same(problemsOf(twoBad).length, 2, "two bad fields = two problems");
  check(problemsOf(twoBad).some((p) => p.startsWith("scope.include_cities:")), "the second one is named too");
}
{
  const input = clapton();
  (input as { scope?: unknown }).scope = undefined;
  const r = parsePlanInput(input);
  check(r.ok, "a missing scope block is the open scope, not a problem");
  same(r.plan.scope, emptyPlan().scope, "missing scope = the empty scope");
}

// ---- lib/uploader/plan.ts: parsePlanInput - rules, suppliers, notes ----------------------------
{
  const input = clapton();
  input.rules.without_location = "skip";
  same(parsePlanInput(input).plan.rules, { with_location: "package", without_location: "skip" }, "skip is valid");
  (input.rules as { without_location: unknown }).without_location = "hotel_only";
  const bad = parsePlanInput(input);
  problemFor(bad, "rules.without_location", "an unknown without_location");
  same(bad.plan.rules.without_location, "skip", "a bad without_location falls back to skip");
  (input.rules as { without_location: unknown }).without_location = undefined;
  const missing = parsePlanInput(input);
  check(missing.ok, "a missing without_location is the default, not a problem");
  same(missing.plan.rules.without_location, "skip", "missing without_location = skip");
  (input.rules as { with_location: unknown }).with_location = "ticket_only";
  const forced = parsePlanInput(input);
  check(forced.ok, "with_location is not the model's to choose - no problem");
  same(forced.plan.rules.with_location, "package", "with_location is always package");
}
{
  const input = clapton();
  (input as { suppliers?: unknown }).suppliers = undefined;
  const r = parsePlanInput(input);
  check(r.ok, "a missing suppliers is not a problem");
  same(r.plan.suppliers, ["tixstock", "livetickets"], "a missing suppliers is filled with the fixed pair");
  (input as { suppliers?: unknown }).suppliers = ["xs2event"];
  const forced = parsePlanInput(input);
  check(forced.ok, "a different suppliers list is not a problem either");
  same(forced.plan.suppliers, ["tixstock", "livetickets"], "suppliers is always the fixed pair");
}
{
  const input = clapton();
  (input as { notes: unknown }).notes = ["  keep Zurich out ", 3, "", "second note"];
  same(parsePlanInput(input).plan.notes, ["keep Zurich out", "second note"], "notes are trimmed strings");
  (input as { notes: unknown }).notes = undefined;
  const missing = parsePlanInput(input);
  check(missing.ok, "missing notes = none, not a problem");
  same(missing.plan.notes, [], "missing notes = []");
  (input as { notes: unknown }).notes = "just text";
  problemFor(parsePlanInput(input), "notes", "notes that is a string");
}

// ---- lib/uploader/plan.ts: parsePlanInput - never throws -------------------------------------
for (const garbage of [null, undefined, "plan", 42, true, [], [1, 2], () => 1]) {
  const r = parsePlanInput(garbage);
  check(!r.ok, `${typeof garbage} / ${JSON.stringify(garbage)} is not a plan`);
  check(problemsOf(r).length >= 1, "and says so");
  same(r.plan.suppliers, ["tixstock", "livetickets"], "the salvage is still a whole plan");
}
{
  // A property read that throws (hostile getter) must come back as a problem, not an exception.
  const booby = Object.defineProperty({}, "subject", {
    get() {
      throw new Error("boom");
    },
    enumerable: true,
  });
  const r = parsePlanInput(booby);
  check(!r.ok, "a throwing getter fails softly");
  check(problemsOf(r)[0].startsWith("plan:"), "and is reported against the whole plan");
  same(r.plan, emptyPlan(), "with the empty plan as the salvage");
}
{
  // Wrong types everywhere - must not escape as an exception, and every field is named.
  const nasty = {
    subject: { kind: {}, name_he: [], name_en: Symbol.iterator },
    scope: { exclude_cities: [[["deep"]]], date_from: {} },
    rules: null,
    markups: { ticket_only: {}, additional: [] },
    suppliers: 5,
    notes: { length: 3 },
  };
  const r = parsePlanInput(nasty);
  check(!r.ok, "a plan made of wrong types fails softly");
  const problems = problemsOf(r);
  for (const field of ["subject.kind", "subject.name_he", "subject.name_en", "scope.date_from", "rules", "markups.ticket_only", "markups.additional", "notes"]) {
    check(problems.some((p) => p.startsWith(`${field}:`)), `problem names ${field}`);
  }
  same(r.plan.markups, { ticket_only: null, additional: null }, "every bad markup is null");
}

// ---- lib/uploader/plan.ts: planDiff -----------------------------------------------------------
{
  const before = clapton();
  const after = clapton();
  after.markups.additional = 75;
  same(planDiff(before, after), [{ field: "markups.additional", from: null, to: 75 }], "additional null -> 75");
  same(planDiff(before, clapton()), [], "equal plans have no diff");
  const many = clapton();
  many.notes = ["a", "b"];
  many.markups.ticket_only = 250;
  many.scope.exclude_cities = ["Skokie", "Zurich"];
  many.scope.date_from = null;
  many.subject.name_en = "Eric Clapton (live)";
  many.rules.without_location = "skip";
  same(
    planDiff(before, many),
    [
      { field: "subject.name_en", from: "Eric Clapton", to: "Eric Clapton (live)" },
      { field: "scope.date_from", from: "2027-05-01", to: null },
      { field: "scope.exclude_cities", from: ["Skokie"], to: ["Skokie", "Zurich"] },
      { field: "rules.without_location", from: "ticket_only", to: "skip" },
      { field: "markups.ticket_only", from: 200, to: 250 },
      { field: "notes", from: ["no hotel in Zurich"], to: ["a", "b"] },
    ],
    "diff lists every changed leaf in plan order (subject, scope, rules, markups, notes), arrays whole",
  );
  const sameList = clapton();
  sameList.scope.exclude_cities = ["Skokie"];
  same(planDiff(before, sameList), [], "equal arrays are not a change (compared by value)");
  const reordered = clapton();
  reordered.scope.exclude_cities = ["Skokie", "Zurich"];
  const reordered2 = clapton();
  reordered2.scope.exclude_cities = ["Zurich", "Skokie"];
  same(planDiff(reordered, reordered2).length, 1, "a reordered list is a change");
}

// ---- lib/uploader/plan.ts: applyPriorDefaults -------------------------------------------------
{
  const plan = clapton(); // ticket_only 200, additional null
  const a = applyPriorDefaults(plan, { ticket_only: 300, additional: 75 });
  same(a.plan.markups, { ticket_only: 200, additional: 75 }, "only the null markup is filled; a given one is never overwritten");
  same(a.fromPrior, ["additional"], "and reported");
  same(plan.markups, { ticket_only: 200, additional: null }, "the input plan is not mutated");

  const bothNull = clapton();
  bothNull.markups = { ticket_only: null, additional: null };
  const b = applyPriorDefaults(bothNull, { ticket_only: 250, additional: 75 });
  same(b.plan.markups, { ticket_only: 250, additional: 75 }, "both nulls filled");
  same(b.fromPrior, ["ticket_only", "additional"], "both reported, ticket_only first");

  const zeroKept = clapton();
  zeroKept.markups = { ticket_only: 0, additional: 0 };
  const z = applyPriorDefaults(zeroKept, { ticket_only: 250, additional: 75 });
  same(z.plan.markups, { ticket_only: 0, additional: 0 }, "a 0 markup is a choice, not a gap");
  same(z.fromPrior, [], "so nothing comes from the prior");

  const priorHalf = applyPriorDefaults(bothNull, { ticket_only: null, additional: 90 });
  same(priorHalf.plan.markups, { ticket_only: null, additional: 90 }, "a null in the prior fills nothing");
  same(priorHalf.fromPrior, ["additional"], "and is not reported");

  // A prior comes out of a jsonb row: a missing key, a string or an out-of-range number are all realistic.
  const loose = (prior: unknown) => applyPriorDefaults(bothNull, prior as { ticket_only: number | null; additional: number | null });
  const missingKey = loose({ ticket_only: undefined, additional: 75 });
  same(missingKey.plan.markups, { ticket_only: null, additional: 75 }, "a prior with an undefined key fills only the other markup");
  same(missingKey.fromPrior, ["additional"], "and does not report the undefined one as filled");
  const noKey = loose({ additional: 75 });
  same(noKey.plan.markups, { ticket_only: null, additional: 75 }, "a prior with a missing key behaves the same");
  same(noKey.fromPrior, ["additional"], "and reports only what was filled");
  const garbage = loose({ ticket_only: "250", additional: -1 });
  same(garbage.plan.markups, { ticket_only: null, additional: null }, "a string / negative prior fills nothing");
  same(garbage.fromPrior, [], "and reports nothing");
  const outOfRange = loose({ ticket_only: MARKUP_MAX + 1, additional: 250.5 });
  same(outOfRange.plan.markups, { ticket_only: null, additional: null }, "an over-range / fractional prior fills nothing");
  same(outOfRange.fromPrior, [], "and reports nothing");
  const edges = loose({ ticket_only: 0, additional: MARKUP_MAX });
  same(edges.plan.markups, { ticket_only: 0, additional: MARKUP_MAX }, "the 0 and MARKUP_MAX edges are valid priors");
  same(edges.fromPrior, ["ticket_only", "additional"], "and both are reported");
  const empty = loose({});
  same(empty.plan.markups, { ticket_only: null, additional: null }, "an empty prior object fills nothing");
  same(empty.fromPrior, [], "and reports nothing");
  check(
    Object.values(missingKey.plan.markups).every((v) => v === null || typeof v === "number"),
    "no markup is ever undefined after a fill",
  );

  const none = applyPriorDefaults(bothNull, null);
  same(none.plan, bothNull, "no prior = the plan unchanged");
  same(none.fromPrior, [], "no prior = nothing reported");
  const copy = applyPriorDefaults(bothNull, { ticket_only: 1, additional: 2 });
  copy.plan.notes.push("x");
  same(bothNull.notes, ["no hotel in Zurich"], "the returned plan does not share arrays with the input");
}

// ---- lib/uploader/shows.ts: find, group, ask, dedupe, remember --------------------------------
{
  // Rows shaped like the real catalogs (tixstock_events / live_events on 21.10). NOW puts the
  // window floor at 2027-04-04 (today + SHOW_WINDOW_DAYS), so every fixture date is deterministic.
  const NOW = new Date("2027-04-01T09:00:00Z");
  const tixRow = (over: Partial<TixRow> & { event_id: string }): TixRow => ({
    event_name: "Eric Clapton London",
    show_date: "2027-05-20T19:30:00+00:00",
    venue_name: "London Royal Albert Hall",
    city_name: "London",
    country_code: "GB",
    performers: [{ name: "Eric Clapton" }],
    category_name: "Rock & Pop",
    sub_category_name: null,
    ticket_count: 141,
    venue_map_url: "https://tixstock.example/maps/royal-albert-hall.svg",
    lat: 51.5009,
    lon: -0.1774,
    ...over,
  });
  const liveRow = (over: Partial<LiveRow> & { event_id: number }): LiveRow => ({
    event_name: "Eric Clapton",
    event_name_heb: "אריק קלפטון",
    show_date: "2027-05-20T19:30:00+00:00",
    city_name: "London",
    country_name: "United Kingdom",
    performers: [{ name: "Eric Clapton", hebName: "אריק קלפטון" }],
    event_type: "music_live_event_dynamic",
    sellable: 4,
    ...over,
  });
  /** city, day and the two supplier ids - enough to tell every show of a fixture apart. */
  const outline = (s: ShowIdentity) => [s.city, s.date, s.suppliers.tixstock?.event_id ?? null, s.suppliers.livetickets?.event_id ?? null];

  const ericClapton: Subject = {
    kind: "artist",
    name_en: "Eric Clapton",
    name_he: "אריק קלפטון",
    aliases: ["Eric Clapton", "אריק קלפטון"],
  };
  const tBham = tixRow({
    event_id: "tx-bham-0517",
    event_name: "Eric Clapton Birmingham",
    show_date: "2027-05-17T19:30:00+00:00",
    venue_name: "Birmingham Utilita Arena",
    city_name: "Birmingham",
    ticket_count: 88,
    venue_map_url: "https://tixstock.example/maps/utilita-arena.svg",
    lat: 52.4797,
    lon: -1.9149,
  });
  const tLon20 = tixRow({ event_id: "tx-lon-0520" });
  const tLon23 = tixRow({ event_id: "tx-lon-0523", show_date: "2027-05-23T19:30:00+00:00", ticket_count: 97 });
  const tTribute = tixRow({
    event_id: "tx-skokie-tribute",
    event_name: "Journeyman - A Tribute to Eric Clapton",
    show_date: "2027-05-29T20:00:00+00:00",
    venue_name: "Skokie North Shore Center",
    city_name: "Skokie",
    country_code: "US",
    performers: [{ name: "Journeyman - A Tribute to Eric Clapton" }],
    ticket_count: 40,
    venue_map_url: null,
    lat: 42.0334,
    lon: -87.7334,
  });
  const lBham = liveRow({ event_id: 9001, show_date: "2027-05-17T19:30:00+00:00", city_name: "Birmingham" });
  const lLon20 = liveRow({ event_id: 9002 });
  const lLon21 = liveRow({ event_id: 9003, show_date: "2027-05-21T19:30:00+00:00" });
  const claptonTix = [tBham, tLon20, tLon23, tTribute];
  const claptonLive = [lBham, lLon20, lLon21];

  // calendarDay / showKey
  same(calendarDay("2027-05-20T23:30:00-05:00"), "2027-05-20", "calendarDay: the day the supplier prints, no timezone arithmetic");
  same(calendarDay("2027-05-20"), "2027-05-20", "calendarDay: a bare day stays itself");
  same(showKey("GB", " London ", "2027-05-20T19:30:00+00:00"), "london|2027-05-20", "showKey: normalized city + printed day");
  same(
    showKey(null, "LONDON", "2027-05-20"),
    showKey("GB", "London", "2027-05-20T19:30:00+00:00"),
    "showKey: a Live row (no country code) and a Tix row (GB) of the same city and day share the key",
  );

  // tixMatchesSubject / liveMatchesSubject - artist
  const anyScope = emptyPlan().scope;
  same(tixMatchesSubject(tLon20, ericClapton, anyScope), "match", "tix artist: the performer IS the subject");
  same(tixMatchesSubject(tTribute, ericClapton, anyScope), "tribute", "tix artist: the name only in the title, another performer = tribute");
  same(
    tixMatchesSubject(tixRow({ event_id: "tx-oasis", event_name: "Oasis London", performers: [{ name: "Oasis" }] }), ericClapton, anyScope),
    "no",
    "tix artist: someone else entirely = no",
  );
  check(liveMatchesSubject(lLon20, ericClapton, anyScope), "live artist: the performer matches");
  check(
    liveMatchesSubject(liveRow({ event_id: 9020, performers: [] }), ericClapton, anyScope),
    "live artist: no performers, but the event name IS the subject",
  );

  // Hebrew subject: the Hebrew alias carries the match
  const hebrewClapton: Subject = { kind: "artist", name_en: "Eric Clapton", name_he: null, aliases: ["אריק קלפטון"] };
  check(liveMatchesSubject(lLon20, hebrewClapton, anyScope), "hebrew: Live performer hebName 'אריק קלפטון' + name 'Eric Clapton' matches");
  check(
    liveMatchesSubject(
      liveRow({ event_id: 9010, event_name: "E. Clapton Live", event_name_heb: null, performers: [{ name: "E. Clapton", hebName: "אריק קלפטון" }] }),
      hebrewClapton,
      anyScope,
    ),
    "hebrew: the Hebrew alias alone carries the match when the English spelling differs",
  );
  check(
    !liveMatchesSubject(
      liveRow({
        event_id: 9011,
        event_name: "Journeyman",
        event_name_heb: "מחווה לאריק קלפטון",
        performers: [{ name: "Journeyman", hebName: "ג'רנימן" }],
      }),
      hebrewClapton,
      anyScope,
    ),
    "hebrew: a Hebrew title naming the artist with another performer is not a match",
  );

  // Clapton fixture: four shows, the tribute excluded, nothing to ask
  {
    const g = groupRows(claptonTix, claptonLive, ericClapton, clapton(), NOW);
    same(
      g.shows.map(outline),
      [
        ["Birmingham", "2027-05-17", "tx-bham-0517", 9001],
        ["London", "2027-05-20", "tx-lon-0520", 9002],
        ["London", "2027-05-21", null, 9003],
        ["London", "2027-05-23", "tx-lon-0523", null],
      ],
      "clapton: Birmingham (both), London 20.05 (both), London 21.05 (Live only), London 23.05 (Tix only)",
    );
    same(
      g.shows[0],
      {
        name_english: "Eric Clapton Birmingham",
        city: "Birmingham",
        country_code: "GB",
        venue: "Birmingham Utilita Arena",
        date: "2027-05-17",
        lat: 52.4797,
        lon: -1.9149,
        suppliers: {
          tixstock: {
            event_id: "tx-bham-0517",
            name: "Eric Clapton Birmingham",
            ticket_count: 88,
            venue_map_url: "https://tixstock.example/maps/utilita-arena.svg",
          },
          livetickets: { event_id: 9001, name_heb: "אריק קלפטון", sellable: 4 },
        },
        competition: null,
        home_team: null,
        away_team: null,
        fallback: [],
      },
      "clapton: a paired show carries the Tix identity (venue, coords, GB) and both supplier refs",
    );
    const liveOnly = g.shows[2];
    same(
      [liveOnly.lat, liveOnly.lon, liveOnly.venue, liveOnly.country_code, liveOnly.name_english],
      [null, null, null, null, "Eric Clapton"],
      "clapton: a Live-only show has no coords, no venue and no country code",
    );
    same(g.excluded, [{ row: "tixstock", id: "tx-skokie-tribute", reason: "tribute" }], "clapton: the tribute act is excluded, named");
    same(g.questions, [], "clapton: London 21.05 is one day off a London date that already has its exact pair - no question");
  }

  // Two Tix rows on one key: an empty twin is dropped, a selling twin is a question
  {
    // A matinee on the same day: a real second show or a duplicate - only a person can say.
    const twin = (ticket_count: number) =>
      tixRow({ event_id: "tx-lon-0520-b", event_name: "Eric Clapton - London (Extra)", show_date: "2027-05-20T14:00:00+00:00", ticket_count });
    const zero = groupRows([...claptonTix, twin(0)], claptonLive, ericClapton, clapton(), NOW);
    same(zero.questions, [], "zero twin: no question");
    check(
      zero.excluded.some((e) => e.row === "tixstock" && e.id === "tx-lon-0520-b" && e.reason === "zero_tickets_twin"),
      "zero twin: the empty listing is excluded as zero_tickets_twin",
    );
    same(
      zero.shows.map(outline)[1],
      ["London", "2027-05-20", "tx-lon-0520", 9002],
      "zero twin: London 20.05 keeps the selling listing and its Live pair",
    );

    const five = groupRows([...claptonTix, twin(5)], claptonLive, ericClapton, clapton(), NOW);
    same(five.questions.length, 1, "selling twin: exactly one question");
    const { show, question } = five.questions[0];
    same(question.kind, "pick_show", "selling twin: pick_show");
    same(
      question.options,
      [
        { key: "tx-lon-0520", label: "Eric Clapton London · London Royal Albert Hall · 20.05.2027 19:30" },
        { key: "tx-lon-0520-b", label: "Eric Clapton - London (Extra) · London Royal Albert Hall · 20.05.2027 14:00" },
        { key: "both", label: "שתיהן - שני אירועים" },
        { key: "skip", label: "דלג על ההופעה" },
      ],
      "selling twin: one option per listing (bigger first, with its time), then both, then skip",
    );
    same(
      question.text,
      "TixStock מציג שתי הופעות ב-London ב-20.05.2027: Eric Clapton London / Eric Clapton - London (Extra) - איזו שייכת לטור?",
      "selling twin: the question text names both listings",
    );
    same(
      [question.free_text, question.key, question.asked_at, question.task_id],
      [false, "eric clapton|london|2027-05-20", NOW.toISOString(), null],
      "selling twin: closed options, key = subject|city|day, asked now, no task yet",
    );
    same(question.key, questionKey(show, "Eric Clapton"), "selling twin: the key is questionKey of the asked show");
    same(outline(show), ["London", "2027-05-20", "tx-lon-0520", 9002], "selling twin: the asked show keeps the Live pair");
    same(
      five.shows.map((s) => s.date),
      ["2027-05-17", "2027-05-21", "2027-05-23"],
      "selling twin: the asked show is not also in shows",
    );
  }

  // Live one day off the only Tix row of the city -> pick_date; two days off -> two shows
  {
    const g = groupRows([tLon20], [lLon21], ericClapton, clapton(), NOW);
    same(g.shows, [], "pick_date: neither row is a show until the date is decided");
    same(g.questions.length, 1, "pick_date: one question");
    const { show, question } = g.questions[0];
    same(question.kind, "pick_date", "pick_date: kind");
    same(question.text, "ב-London: TixStock אומר 20.05.2027, LiveTickets 21.05.2027 - איזה תאריך נכון?", "pick_date: text");
    same(
      question.options,
      [
        { key: "tix:2027-05-20", label: "תאריך TixStock 20.05.2027" },
        { key: "live:2027-05-21", label: "תאריך LiveTickets 21.05.2027" },
        { key: "both", label: "שתי הופעות" },
        { key: "skip", label: "דלג על ההופעה" },
      ],
      "pick_date: TixStock's day, LiveTickets' day, both, skip",
    );
    same([question.free_text, question.key], [false, "eric clapton|london|2027-05-20"], "pick_date: closed, keyed on the Tix day");
    same(outline(show), ["London", "2027-05-20", "tx-lon-0520", 9003], "pick_date: the asked show holds both rows");

    const apart = groupRows([tLon20], [liveRow({ event_id: 9005, show_date: "2027-05-22T19:30:00+00:00" })], ericClapton, clapton(), NOW);
    same([apart.shows.length, apart.questions.length], [2, 0], "pick_date: two days apart = two shows, no question");

    // No double use: a Live row between two Tix days, or a Tix day between two Live rows, asks nothing.
    const tLon22 = tixRow({ event_id: "tx-lon-0522", show_date: "2027-05-22T19:30:00+00:00" });
    const between = groupRows([tLon20, tLon22], [lLon21], ericClapton, clapton(), NOW);
    same(between.questions, [], "pick_date: a Live day with a Tix neighbour on each side is no single question");
    same(
      between.shows.map(outline),
      [
        ["London", "2027-05-20", "tx-lon-0520", null],
        ["London", "2027-05-21", null, 9003],
        ["London", "2027-05-22", "tx-lon-0522", null],
      ],
      "pick_date: Tix 20 + Live 21 + Tix 22 = three shows, the Live one on its own",
    );
    const lLon19 = liveRow({ event_id: 9006, show_date: "2027-05-19T19:30:00+00:00" });
    const shared = groupRows([tLon20], [lLon19, lLon21], ericClapton, clapton(), NOW);
    same(shared.questions, [], "pick_date: a Tix day wanted by two Live neighbours is no single question");
    same(
      shared.shows.map(outline),
      [
        ["London", "2027-05-19", null, 9006],
        ["London", "2027-05-20", "tx-lon-0520", null],
        ["London", "2027-05-21", null, 9003],
      ],
      "pick_date: Live 19 + Tix 20 + Live 21 = three shows, nothing merged",
    );
  }

  // Two Live rows on one key: the same pick_show, unless one sells nothing
  {
    const g = groupRows([], [lLon20, liveRow({ event_id: 9004, sellable: 2 })], ericClapton, clapton(), NOW);
    same(g.questions.length, 1, "live twins: one question");
    same(
      g.questions[0].question.options.map((o) => o.key),
      ["live:9002", "live:9004", "both", "skip"],
      "live twins: options keyed live:<event_id>, then both, then skip",
    );
    same(
      g.questions[0].question.options[0].label,
      "Eric Clapton · 20.05.2027 19:30 · LiveTickets #9002",
      "live twins: the label carries the day, the time and the Live id",
    );
    check(g.questions[0].question.text.startsWith("LiveTickets מציג שתי הופעות ב-London"), "live twins: the text names LiveTickets");
    const empty = groupRows([], [lLon20, liveRow({ event_id: 9004, sellable: 0 })], ericClapton, clapton(), NOW);
    same([empty.questions.length, empty.shows.map(outline)], [0, [["London", "2027-05-20", null, 9002]]], "live twins: the empty one dropped");
    same(empty.excluded, [{ row: "livetickets", id: "9004", reason: "zero_tickets_twin" }], "live twins: named as zero_tickets_twin");
  }

  // Same city name in two countries on the same day: two shows, not a question
  {
    const alabama = tixRow({
      event_id: "tx-bham-al-0517",
      event_name: "Eric Clapton Birmingham AL",
      show_date: "2027-05-17T20:00:00+00:00",
      venue_name: "Legacy Arena",
      city_name: "Birmingham",
      country_code: "US",
      lat: 33.5207,
      lon: -86.8025,
    });
    const g = groupRows([tBham, alabama], [], ericClapton, clapton(), NOW);
    same([g.shows.length, g.questions.length], [2, 0], "country tie-break: GB and US Birmingham are two shows");
  }

  // The window and the cities
  {
    const open = emptyPlan();
    open.subject = { kind: "artist", name_he: null, name_en: "Eric Clapton" };
    const early = tixRow({ event_id: "tx-lon-0403", show_date: "2027-04-03T19:30:00+00:00" });
    const floor = tixRow({ event_id: "tx-lon-0404", show_date: "2027-04-04T19:30:00+00:00" });
    const g = groupRows([early, floor], [], ericClapton, open, NOW);
    same(g.shows.map((s) => s.date), ["2027-04-04"], "window: opens today + SHOW_WINDOW_DAYS when date_from is empty");
    same(g.excluded, [{ row: "tixstock", id: "tx-lon-0403", reason: "out_of_scope" }], "window: an earlier show is out_of_scope");
    const before = emptyPlan();
    before.scope.date_from = "2027-03-01";
    same(
      groupRows([early, floor], [], ericClapton, before, NOW).shows.map((s) => s.date),
      ["2027-04-04"],
      "window: a date_from earlier than today + SHOW_WINDOW_DAYS never reopens what the site hides",
    );
    const late = tixRow({ event_id: "tx-lon-0701", show_date: "2027-07-01T19:30:00+00:00" });
    same(
      groupRows([late], [], ericClapton, clapton(), NOW).excluded,
      [{ row: "tixstock", id: "tx-lon-0701", reason: "out_of_scope" }],
      "window: after date_to is out_of_scope",
    );

    const onlyLondon = clapton();
    onlyLondon.scope.exclude_cities = [];
    onlyLondon.scope.include_cities = ["london"];
    const inc = groupRows(claptonTix, claptonLive, ericClapton, onlyLondon, NOW);
    same([...new Set(inc.shows.map((s) => s.city))], ["London"], "include_cities: only London shows");
    same(
      inc.excluded.filter((e) => e.reason === "out_of_scope"),
      [
        { row: "tixstock", id: "tx-bham-0517", reason: "out_of_scope" },
        { row: "livetickets", id: "9001", reason: "out_of_scope" },
      ],
      "include_cities: Birmingham's rows on both suppliers are out_of_scope",
    );
    const noBham = clapton();
    noBham.scope.exclude_cities = ["Birmingham"];
    same(
      groupRows(claptonTix, claptonLive, ericClapton, noBham, NOW).shows.map((s) => s.city),
      ["London", "London", "London"],
      "exclude_cities: Birmingham is left out",
    );
  }

  // Team: home games by default, every fixture when home_only is off
  {
    const liverpool: Subject = { kind: "team", name_en: "Liverpool FC", name_he: "ליברפול", aliases: ["ליברפול", "Liverpool"] };
    const home = tixRow({
      event_id: "tx-lfc-cpfc",
      event_name: "Liverpool FC vs Crystal Palace FC",
      show_date: "2027-04-24T14:00:00+00:00",
      venue_name: "Anfield",
      city_name: "Liverpool",
      performers: [{ name: "Liverpool FC" }, { name: "Crystal Palace FC" }],
      category_name: "English Premier League",
      ticket_count: 230,
      venue_map_url: "https://tixstock.example/maps/anfield.svg",
      lat: 53.4308,
      lon: -2.9608,
    });
    const away = tixRow({
      event_id: "tx-afc-lfc",
      event_name: "Arsenal FC vs Liverpool FC",
      show_date: "2027-05-01T16:30:00+00:00",
      venue_name: "Emirates Stadium",
      city_name: "London",
      performers: [{ name: "Arsenal FC" }, { name: "Liverpool FC" }],
      category_name: "English Premier League",
      ticket_count: 60,
      venue_map_url: "https://tixstock.example/maps/emirates.svg",
      lat: 51.555,
      lon: -0.1086,
    });
    const teamPlan = (homeOnly: boolean): UploaderPlan => {
      const p = emptyPlan();
      p.subject = { kind: "team", name_he: "ליברפול", name_en: "Liverpool FC" };
      p.scope.home_only = homeOnly;
      return p;
    };
    same(tixMatchesSubject(home, liverpool, teamPlan(true).scope), "match", "team: a home fixture matches");
    same(tixMatchesSubject(away, liverpool, teamPlan(true).scope), "away", "team: an away fixture with home_only = away");
    same(tixMatchesSubject(away, liverpool, teamPlan(false).scope), "match", "team: every fixture when home_only is off");

    const homeOnly = groupRows([home, away], [], liverpool, teamPlan(true), NOW);
    same(homeOnly.shows.map(outline), [["Liverpool", "2027-04-24", "tx-lfc-cpfc", null]], "team home_only: 1 show");
    same(
      [homeOnly.shows[0].home_team, homeOnly.shows[0].away_team, homeOnly.shows[0].competition],
      ["Liverpool FC", "Crystal Palace FC", "English Premier League"],
      "team: the show names its sides and its league",
    );
    same(homeOnly.excluded, [{ row: "tixstock", id: "tx-afc-lfc", reason: "away" }], "team home_only: the away fixture is excluded as away");
    const all = groupRows([home, away], [], liverpool, teamPlan(false), NOW);
    same(all.shows.map((s) => s.date), ["2027-04-24", "2027-05-01"], "team all fixtures: 2 shows");
    same(all.excluded, [], "team all fixtures: nothing excluded");

    const liveHome = liveRow({
      event_id: 9101,
      event_name: "Liverpool vs Crystal Palace",
      event_name_heb: "ליברפול נגד קריסטל פאלאס",
      show_date: "2027-04-24T14:00:00+00:00",
      city_name: "Liverpool",
      performers: [
        { name: "Liverpool", hebName: "ליברפול" },
        { name: "Crystal Palace", hebName: "קריסטל פאלאס" },
      ],
      event_type: "sports_live_event_dynamic",
    });
    const liveAway = liveRow({
      event_id: 9102,
      event_name: "Arsenal vs Liverpool",
      event_name_heb: "ארסנל נגד ליברפול",
      show_date: "2027-05-01T16:30:00+00:00",
      performers: [{ name: "Arsenal" }, { name: "Liverpool" }],
      event_type: "sports_live_event_dynamic",
    });
    check(liveMatchesSubject(liveHome, liverpool, teamPlan(true).scope), "live team: the first performer is the team = home");
    check(!liveMatchesSubject(liveAway, liverpool, teamPlan(true).scope), "live team: an away fixture is not a match with home_only");
    check(liveMatchesSubject(liveAway, liverpool, teamPlan(false).scope), "live team: but is without it");
    same(
      groupRows([home], [liveHome], liverpool, teamPlan(true), NOW).shows.map(outline),
      [["Liverpool", "2027-04-24", "tx-lfc-cpfc", 9101]],
      "live team: the Live home fixture pairs with the Tix one",
    );

    // An away game must not come back through LiveTickets, which lists Liverpool first here.
    const liveAwayLfcFirst = liveRow({
      event_id: 9103,
      event_name: "Arsenal vs Liverpool",
      event_name_heb: "ארסנל נגד ליברפול",
      show_date: "2027-05-01T16:30:00+00:00",
      performers: [
        { name: "Liverpool", hebName: "ליברפול" },
        { name: "Arsenal", hebName: "ארסנל" },
      ],
      event_type: "sports_live_event_dynamic",
    });
    check(
      !liveMatchesSubject(liveAwayLfcFirst, liverpool, teamPlan(true).scope),
      "live team: 'Arsenal vs Liverpool' is away although Liverpool is the first performer - the name decides",
    );
    const awayPair = groupRows([away], [liveAwayLfcFirst], liverpool, teamPlan(true), NOW);
    same(awayPair.shows, [], "away pair: no show from either supplier");
    same(
      awayPair.excluded,
      [
        { row: "tixstock", id: "tx-afc-lfc", reason: "away" },
        { row: "livetickets", id: "9103", reason: "away" },
      ],
      "away pair: both rows excluded as away",
    );
    // A Live name that is no fixture falls back to performer order - and the Tix away row still rules it out.
    const liveNoFixtureName = liveRow({ ...liveAwayLfcFirst, event_id: 9104, event_name: "Arsenal – Liverpool", event_name_heb: null });
    check(
      liveMatchesSubject(liveNoFixtureName, liverpool, teamPlan(true).scope),
      "live team: a name that is no fixture falls back to performer order (Liverpool first = home)",
    );
    same(
      groupRows([away], [liveNoFixtureName], liverpool, teamPlan(true), NOW).excluded,
      [
        { row: "tixstock", id: "tx-afc-lfc", reason: "away" },
        { row: "livetickets", id: "9104", reason: "away" },
      ],
      "away pair: a Live row on the day and city of a Tix away fixture is away too",
    );
  }

  // Competition: the category (or sub-category) names it, the round narrows it
  {
    const ucl: Subject = { kind: "competition", name_en: "UEFA Champions League", name_he: null, aliases: [] };
    const r16 = tixRow({
      event_id: "tx-rma-mci",
      event_name: "Real Madrid vs Manchester City",
      show_date: "2027-03-10T20:00:00+00:00",
      venue_name: "Santiago Bernabeu",
      city_name: "Madrid",
      country_code: "ES",
      performers: [{ name: "Real Madrid" }, { name: "Manchester City" }],
      category_name: "UEFA Champions League",
      sub_category_name: "Round of 16",
      lat: 40.4531,
      lon: -3.6883,
    });
    const europa = tixRow({ ...r16, event_id: "tx-europa", event_name: "AS Roma vs Real Betis", category_name: "UEFA Europa League" });
    const quarter = tixRow({ ...r16, event_id: "tx-qf", sub_category_name: "Quarter Final" });
    const r16Scope = { ...emptyPlan().scope, round: "Round of 16" };
    same(tixMatchesSubject(r16, ucl, r16Scope), "match", "competition: category + round of 16 matches");
    same(tixMatchesSubject(europa, ucl, r16Scope), "no", "competition: a Europa League row is not the Champions League");
    same(tixMatchesSubject(quarter, ucl, r16Scope), "no", "competition: another round is not this run");
    same(tixMatchesSubject(quarter, ucl, emptyPlan().scope), "match", "competition: no round = every round");
    same(
      tixMatchesSubject(r16, { ...ucl, name_en: "Champions League" }, r16Scope),
      "match",
      "competition: the supplier's longer category name contains the subject's",
    );
    const cPlan = emptyPlan();
    cPlan.subject = { kind: "competition", name_he: null, name_en: "UEFA Champions League" };
    cPlan.scope.round = "Round of 16";
    const g = groupRows([{ ...r16, show_date: "2027-04-14T20:00:00+00:00" }, europa], [], ucl, cPlan, new Date("2027-04-01T09:00:00Z"));
    same(
      g.shows.map((s) => [s.home_team, s.away_team, s.competition]),
      [["Real Madrid", "Manchester City", "UEFA Champions League"]],
      "competition: one fixture, its sides and its competition",
    );

    // A sub-category must BE the round: "Final" is not the semi or the quarter final.
    const finalScope = { ...emptyPlan().scope, round: "Final" };
    same(
      ["Final", "Semi Final", "Quarter Final"].map((sub) =>
        tixMatchesSubject(tixRow({ ...r16, event_id: `tx-${sub}`, sub_category_name: sub }), ucl, finalScope),
      ),
      ["match", "no", "no"],
      "competition: round 'Final' matches only the sub-category 'Final'",
    );
    same(
      tixMatchesSubject(tixRow({ ...r16, event_id: "tx-nosub", event_name: "Champions League Final 2027", sub_category_name: null }), ucl, finalScope),
      "match",
      "competition: without a sub-category, the round text in the title is enough",
    );

    // Two Premier League fixtures in London on one Saturday are two shows; a true twin is still a question.
    const epl: Subject = { kind: "competition", name_en: "English Premier League", name_he: null, aliases: [] };
    const eplPlan = emptyPlan();
    eplPlan.subject = { kind: "competition", name_he: null, name_en: "English Premier League" };
    const fixture = (over: Partial<TixRow> & { event_id: string }): TixRow =>
      tixRow({ show_date: "2027-05-08T14:00:00+00:00", city_name: "London", category_name: "English Premier League", ...over });
    const arsChe = fixture({
      event_id: "tx-ars-che",
      event_name: "Arsenal FC vs Chelsea FC",
      venue_name: "Emirates Stadium",
      performers: [{ name: "Chelsea FC" }, { name: "Arsenal FC" }],
    });
    const totFul = fixture({
      event_id: "tx-tot-ful",
      event_name: "Tottenham Hotspur FC vs Fulham FC",
      venue_name: "Tottenham Hotspur Stadium",
      performers: [{ name: "Tottenham Hotspur FC" }, { name: "Fulham FC" }],
      show_date: "2027-05-08T16:30:00+00:00",
    });
    const saturday = groupRows([arsChe, totFul], [], epl, eplPlan, NOW);
    same(saturday.questions, [], "football key: two fixtures in one city on one day ask nothing");
    same(
      saturday.shows.map((s) => [s.date, s.home_team, s.away_team, s.suppliers.tixstock?.event_id]),
      [
        ["2027-05-08", "Arsenal FC", "Chelsea FC", "tx-ars-che"],
        ["2027-05-08", "Tottenham Hotspur FC", "Fulham FC", "tx-tot-ful"],
      ],
      "football key: two shows, home side from the fixture name (not performer order)",
    );
    same(
      questionKey(saturday.shows[0], "English Premier League"),
      "english premier league|london|2027-05-08|arsenal",
      "football key: a football question is remembered per home side",
    );
    same(
      showKey(null, "London", "2027-05-08", "Arsenal"),
      showKey("GB", "London", "2027-05-08T14:00:00+00:00", "Arsenal FC"),
      "football key: LiveTickets' 'Arsenal' and TixStock's 'Arsenal FC' share the key",
    );
    const arsCheAgain = fixture({ ...arsChe, event_id: "tx-ars-che-2", ticket_count: 12 });
    const trueTwin = groupRows([arsChe, arsCheAgain, totFul], [], epl, eplPlan, NOW);
    same(trueTwin.questions.length, 1, "football key: two listings of the SAME fixture are still a pick_show");
    same(
      trueTwin.questions[0].question.options.map((o) => o.key),
      ["tx-ars-che", "tx-ars-che-2", "both", "skip"],
      "football key: the twin's options",
    );
    same(trueTwin.shows.map((s) => s.home_team), ["Tottenham Hotspur FC"], "football key: the other fixture is untouched");
  }

  // existingEventFor: an eid beats everything; else name + day (+ IATA once the build knows it)
  {
    const g = groupRows(claptonTix, claptonLive, ericClapton, clapton(), NOW);
    const [bham, lon20, lon21, lon23] = g.shows;
    const existing: ExistingEvent[] = [
      { id: 501, name_english: "Eric Clapton London", date: "2027-05-20", city_iata: "LON", eids: ["tx-lon-0520"], is_hidden: true },
      { id: 502, name_english: "Eric Clapton Birmingham", date: "2027-05-17", city_iata: "BHX", eids: [], is_hidden: false },
      { id: 503, name_english: "Eric Clapton", date: "2027-05-21", city_iata: null, eids: ["9003"], is_hidden: false },
    ];
    same(existingEventFor(lon20, existing)?.id, 501, "existing: same TixStock eid, a hidden event included");
    same(existingEventFor(lon21, existing)?.id, 503, "existing: same LiveTickets eid (stored as text)");
    same(existingEventFor(bham, existing)?.id, 502, "existing: same name_english + day when no eid matches");
    same(existingEventFor(bham, existing, "BHX")?.id, 502, "existing: name + day + the same IATA");
    same(existingEventFor(bham, existing, "MAN"), null, "existing: name + day but another IATA is another event");
    same(existingEventFor(lon23, existing), null, "existing: nothing for a show nobody built");
    same(
      existingEventFor(lon20, [
        { id: 601, name_english: "Eric Clapton London", date: "2027-05-20", city_iata: "LON", eids: [], is_hidden: false },
        { id: 602, name_english: "Clapton RAH (old)", date: "2027-05-20", city_iata: "LON", eids: ["tx-lon-0520"], is_hidden: true },
      ])?.id,
      602,
      "existing: an eid match beats a name match listed before it",
    );
    same(
      existingEventFor(lon20, [{ id: 701, name_english: "Eric Clapton London", date: "2027-05-23T00:00:00+00:00", city_iata: "LON", eids: [], is_hidden: false }]),
      null,
      "existing: the same name on another day is not the show",
    );

    // priorAnswerFor / priorRejectionFor: subject + kind + key, the newest run wins
    const key20 = questionKey(lon20, "Eric Clapton");
    same(key20, "eric clapton|london|2027-05-20", "questionKey: normalized subject | showKey");
    const priors: PriorItem[] = [
      { subject_en: "Eric Clapton", kind: "pick_show", key: key20, answer: { key: "tx-lon-0520", text: null }, run_no: 3, by: "Alon" },
      { subject_en: "Eric Clapton", kind: "pick_show", key: key20, answer: { key: "tx-lon-0520-b", text: null }, run_no: 5, by: "Tom" },
      { subject_en: "Eric Clapton", kind: "pick_show", key: key20, answer: null, run_no: 7, by: "Liz" },
      { subject_en: "Eric Clapton", kind: "pick_date", key: key20, answer: { key: "both", text: null }, run_no: 6, by: "Alon" },
      { subject_en: "Oasis", kind: "pick_show", key: key20, answer: { key: "x", text: null }, run_no: 9, by: "Alon" },
      {
        subject_en: "Eric Clapton",
        kind: "rejected",
        key: questionKey(lon23, "Eric Clapton"),
        answer: null,
        run_no: 4,
        by: "Alon",
        reason: "one Royal Albert Hall night is enough",
      },
    ];
    const hit = priorAnswerFor({ subject_en: " eric CLAPTON ", kind: "pick_show", key: key20 }, priors);
    same([hit?.run_no, hit?.answer?.key, hit?.by], [5, "tx-lon-0520-b", "Tom"], "priorAnswerFor: the newest ANSWERED item of that subject, kind and key");
    same(
      priorAnswerFor({ subject_en: "Eric Clapton", kind: "pick_show", key: questionKey(lon23, "Eric Clapton") }, priors),
      null,
      "priorAnswerFor: another key is a miss",
    );
    same(priorAnswerFor({ subject_en: "Eric Clapton", kind: "pick_location", key: key20 }, priors), null, "priorAnswerFor: another kind is a miss");
    same(priorRejectionFor(lon23, "Eric Clapton", priors)?.reason, "one Royal Albert Hall night is enough", "priorRejectionFor: a final rejection is remembered");
    same(priorRejectionFor(lon20, "Eric Clapton", priors), null, "priorRejectionFor: an answered question is not a rejection");
  }
}

// ---- Task 4: tickets + moves ---------------------------------------------------------------
{
  /** A listing as the TixStock feed sends it - the fields the three site rules and the price read. */
  const listing = (category: string | null, amount: string, extra: Partial<TixListing> = {}): TixListing => ({
    seat_details: category === null ? {} : { category },
    ticket: { split_type: "No Preferences" },
    number_of_tickets_for_sale: { quantity_available: 4, split_quantity: 0 },
    proceed_price: { amount, currency: "GBP" },
    ...extra,
  });
  /** A stand-in for `tixstockTicketPriceUsd`: a known rate per currency, so the winner is visible in the number. */
  const calls: { cost: number; currency: string }[] = [];
  const RATE: Record<string, number> = { GBP: 1.3, EUR: 1.1, USD: 1 };
  const priceUsd = (cost: number, currency: string): number => {
    calls.push({ cost, currency });
    return Math.round(cost * (RATE[currency] ?? 1));
  };
  const counter = (): (() => string) => {
    let n = 0;
    return () => `id-${++n}`;
  };

  // The brief's case: two Cat 1 (100, 90), one restricted Cat 2, one with no category.
  const fed = ticketsFromTixStockFeed(
    [
      listing("Cat 1", "100"),
      listing("Cat 1", "90"),
      listing("Cat 2", "50", { restrictions_benefits: { other: "Restricted view" } }),
      listing(null, "40"),
    ],
    "TX-9",
    priceUsd,
    counter(),
  );
  same(
    fed.tickets,
    [
      {
        id: "id-1",
        eid: "TX-9",
        supplier: "tixstock",
        vendor: "TixStock",
        category: "Cat 1",
        supplierCategory: "Cat 1",
        description: "",
        price: 117,
        colorOnTheMap: "rgb(5, 32, 60)",
        available: true,
      },
    ],
    "ticketsFromTixStockFeed: one ticket per category, the cheapest listing priced through priceUsd (GBP 90), eid and id stamped",
  );
  check(calls.some((c) => c.cost === 90 && c.currency === "GBP"), "the winning listing went through the given priceUsd");
  same(
    fed.dropped,
    [
      { category: "", reason: "excluded" },
      { category: "Cat 2", reason: "restricted" },
    ],
    "a listing with no category is dropped excluded; a restricted-view category is dropped restricted",
  );
  same(fed.categoriesSeen, 2, "categoriesSeen counts the distinct categories of ALL listings, before the rules");

  // The cheapest is the cheapest AS PRICED, not by raw cost; the currency falls back like the sync's listingPriceUsd.
  const mixed = ticketsFromTixStockFeed(
    [
      listing("Cat A", "100"), // GBP 100 -> 130
      listing("Cat A", "110", { proceed_price: { amount: "110", currency: "eur" } }), // EUR 110 -> 121: dearer raw, cheaper priced
      listing("Cat B", "80", { proceed_price: { amount: "80" }, face_value: { currency: "EUR" } }), // no proceed currency -> face value's
      listing("Cat C", "70", { proceed_price: { amount: "70" } }), // neither -> GBP
    ],
    "TX-1",
    priceUsd,
    counter(),
  );
  same(
    mixed.tickets.map((t) => [t.category, t.price]),
    [
      ["Cat A", 121],
      ["Cat B", 88],
      ["Cat C", 91],
    ],
    "cheapest as priced (EUR 110 beats GBP 100); currency from proceed_price, else face_value, else GBP; upper-cased",
  );
  same(mixed.tickets.map((t) => t.id), ["id-1", "id-2", "id-3"], "newId is called once per ticket, in category order");

  // The rules: a seller who will not split to a pair drops the category as `split`.
  const rules = ticketsFromTixStockFeed(
    [
      listing("Together", "60", { ticket: { split_type: "Sell Together" }, number_of_tickets_for_sale: { quantity_available: 4 } }),
      listing("One left", "60", { number_of_tickets_for_sale: { quantity_available: 1 } }),
      listing("Side", "60", { restrictions_benefits: { options: ["Side view"] } }),
      listing("Fine", "60"),
      // A refused listing beside a sellable one in the same category does not drop the category.
      listing("Fine", "55", { restrictions_benefits: { other: "Limited view" } }),
    ],
    "TX-2",
    priceUsd,
    counter(),
  );
  same(rules.tickets.map((t) => [t.category, t.price]), [["Fine", 78]], "a category with a sellable listing keeps its ticket (its refused listings do not count)");
  same(
    rules.dropped,
    [
      { category: "One left", reason: "split" },
      { category: "Side", reason: "restricted" },
      { category: "Together", reason: "split" },
    ],
    "one dropped entry per refused CATEGORY, sorted; a split refusal is `split`, a view refusal `restricted`",
  );
  same(rules.categoriesSeen, 4, "categoriesSeen counts refused categories too");

  // Unpriced listings never become a $0 ticket.
  const unpriced = ticketsFromTixStockFeed([listing("Free", ""), listing("Free", "0")], "TX-3", priceUsd, counter());
  same([unpriced.tickets, unpriced.dropped], [[], [{ category: "Free", reason: "excluded" }]], "a category whose listings carry no price is dropped, not sold at the markup alone");
  same(ticketsFromTixStockFeed([], "TX-4", priceUsd, counter()), { tickets: [], dropped: [], categoriesSeen: 0 }, "an empty feed: nothing, nothing dropped");

  // A price function that cannot price (NaN, then 0) leaves the category without a ticket - reported, never a bad price.
  for (const bad of [NaN, 0]) {
    const noPrice = ticketsFromTixStockFeed([listing("Cat 1", "90"), listing("Cat 1", "100")], "TX-5", () => bad, counter());
    same([noPrice.tickets, noPrice.dropped, noPrice.categoriesSeen], [[], [{ category: "Cat 1", reason: "excluded" }], 1], `a priceUsd answering ${bad} for every listing: no ticket, the category is dropped excluded`);
  }

  // Listings group by the NORMALIZED category (what the price sync and main match tickets by); the first-seen raw name is the ticket's.
  const grouped = ticketsFromTixStockFeed(
    [listing("Category 1 (A)", "90"), listing(" Category 1 (B) ", "80"), listing("CATEGORY 1", "95")],
    "TX-6",
    priceUsd,
    counter(),
  );
  same(
    grouped.tickets.map((t) => [t.category, t.supplierCategory, t.price]),
    [["Category 1 (A)", "Category 1 (A)", 104]],
    "'Category 1 (A)' / '(B)' / 'CATEGORY 1' are ONE ticket named by the first-seen raw name, priced from the cheapest (GBP 80)",
  );
  same([grouped.dropped, grouped.categoriesSeen], [[], 1], "one normalized category seen, nothing dropped");
  // A category that normalizes to nothing is the "no category" case.
  const punctuation = ticketsFromTixStockFeed([listing("---", "50")], "TX-7", priceUsd, counter());
  same([punctuation.tickets, punctuation.dropped, punctuation.categoriesSeen], [[], [{ category: "", reason: "excluded" }], 0], "a category with no letters or digits is dropped excluded, like no category");
  same(SUPPLIER_TICKET_COLOR, "rgb(5, 32, 60)", "the supplier ticket colour is the editor's own value");

  // Live: sellable -> ticket in the buildLiveTicketsDrafts shape; non-instant and other blocked -> dropped with their reason.
  const liveCat = (over: Partial<LiveTicketsCategory>): LiveTicketsCategory => ({
    id: "501",
    title: "Gold",
    hebTitle: "זהב",
    description: "ליד הבמה",
    cost: 80,
    maxPerOrder: 6,
    seatingGroupMax: null,
    sellable: true,
    nonInstantOnly: false,
    blockedReason: "",
    ...over,
  });
  const livePrice = (cost: number, currency: SupplierCurrency): number => Math.round(cost * (RATE[currency] ?? 1));
  const stock: LiveTicketsStock = {
    currency: "EUR",
    categories: [
      liveCat({}),
      liveCat({ id: "502", title: "Silver", hebTitle: "כסף", sellable: false, nonInstantOnly: true, blockedReason: "Not instant-confirm" }),
    ],
  };
  const live = ticketsFromLiveStock(stock, "LT-7", livePrice);
  const goldTicket: EventTicket = {
    id: "501",
    eid: "LT-7",
    supplier: "livetickets",
    vendor: "LiveTickets",
    category: "Gold",
    supplierCategory: "Gold",
    description: "ליד הבמה",
    price: 88,
    colorOnTheMap: "rgb(5, 32, 60)",
    available: true,
  };
  same(live.tickets, [goldTicket], "ticketsFromLiveStock: the sellable category is a ticket in buildLiveTicketsDrafts' shape (id = their category id)");
  same(live.dropped, [{ title: "Silver", reason: "Not instant-confirm" }], "a non-instant-only category is dropped with its blockedReason");
  same(live.state, "ok", "a stock that answered is ok");
  const live2 = ticketsFromLiveStock(
    { currency: "USD", categories: [liveCat({ title: "", hebTitle: "יציע", cost: 30 }), liveCat({ id: "503", title: "Pit", sellable: false, blockedReason: "Single seats" })] },
    "LT-8",
    livePrice,
  );
  same(
    [live2.tickets.map((t) => [t.category, t.supplierCategory, t.price]), live2.dropped],
    [[["יציע", "יציע", 30]], [{ title: "Pit", reason: "Single seats" }]],
    "an empty title falls back to hebTitle; any other blocked category is dropped with its reason too",
  );
  same(ticketsFromLiveStock("SOLD_OUT", "LT-7", livePrice), { tickets: [], dropped: [], state: "sold_out" }, "SOLD_OUT: no tickets, state sold_out");
  same(ticketsFromLiveStock(null, "LT-7", livePrice), { tickets: [], dropped: [], state: "unreachable" }, "null (no answer, no snapshot): state unreachable");

  // zoneFromTemplate: the venue template zones a ticket with no zone and never touches one already zoned.
  const map = {
    zones: [{ id: "z-cat1", label: "קטגוריה 1", sections: ["s1"] }],
    supplier_categories: { tixstock: { "cat 1": "z-cat1" } },
  };
  const bare: EventTicket = {
    id: "t-1",
    category: "Cat 1",
    price: 100,
    description: "",
    colorOnTheMap: "rgb(5, 32, 60)",
    supplier: "tixstock",
  };
  const zoned = zoneFromTemplate([bare], "tx_event", map)[0];
  same(
    [zoned.zoneId, zoned.zoneLabel, zoned.supplierCategory],
    ["z-cat1", "קטגוריה 1", "Cat 1"],
    "zoneFromTemplate: a tixstock ticket is zoned from supplier_categories.tixstock['cat 1']",
  );
  const already: EventTicket = { ...bare, id: "t-2", zoneId: "z-other", zoneLabel: "ידני" };
  same(zoneFromTemplate([already], "tx_event", map)[0], already, "zoneFromTemplate leaves an already-zoned ticket alone");
  const unknown: EventTicket = { ...bare, id: "t-3", category: "Cat 9" };
  same(zoneFromTemplate([unknown], "tx_event", map)[0], unknown, "zoneFromTemplate leaves a ticket with no template entry unzoned");
  same(zoneFromTemplate([{ ...bare, supplier: undefined }], "tx_event", map)[0].zoneId, "z-cat1", "a ticket with no supplier takes it from the event type (tx_event = tixstock)");

  // calculateSmartDates, moved to lib/.
  same(calculateSmartDates("2027-05-20"), { departure: "2027-05-18", return: "2027-05-21" }, "calculateSmartDates: two days before, one after");
}

// ---- Task 5: warnings, decisions, names ------------------------------------------------------
{
  // -- warnings.ts ---------------------------------------------------------------------------
  const artistRow = (over: Partial<NonNullable<SubjectRows["artist"]>> = {}): NonNullable<SubjectRows["artist"]> => ({
    id: 7,
    name: "Eric Clapton",
    image_url: "https://img.example/clapton.jpg",
    art_image_url: "https://img.example/clapton-cut.png",
    event_gallery: ["https://img.example/g1.jpg"],
    bio: { text: "guitarist" },
    hasTwin: true,
    ...over,
  });
  const teamRow = (over: Partial<NonNullable<SubjectRows["team"]>> = {}): NonNullable<SubjectRows["team"]> => ({
    id: 9,
    name: "Liverpool FC",
    logo_url: "https://img.example/lfc.png",
    crestInLibrary: true,
    image_url: null,
    art_image_url: null,
    bio: { text: "club" },
    hasTwin: true,
    ...over,
  });
  const rows = (artist: SubjectRows["artist"], team: SubjectRows["team"] = null): SubjectRows => ({ artist, team });
  const facts = (over: Partial<BuildFacts> = {}): BuildFacts => ({
    newVenue: false,
    unzoned: 0,
    totalTickets: 12,
    suppliersUsed: ["tixstock", "livetickets"],
    unreachable: [],
    hebrewName: true,
    farVenue: null,
    ...over,
  });
  const codes = (ws: { code: string }[]): string[] => ws.map((w) => w.code);

  // The brief's Clapton case: a flat photo (no cut-out) and an empty event gallery - and no "page missing".
  const clapton5 = warningsFor("artist", rows(artistRow({ art_image_url: null, event_gallery: [] })), facts());
  same(codes(clapton5), ["no_cutout", "no_event_gallery"], "Clapton: image but no art image + empty event gallery -> no_cutout + no_event_gallery");
  same(
    clapton5.map((w) => w.fix_url),
    ["/templates/artists/7/edit#fix-image", "/templates/artists/7/edit#fix-gallery"],
    "the artist warnings deep-link the gaps radar's own anchors",
  );
  check(clapton5.every((w) => w.text.length > 0 && !w.text.includes("{")), "every warning carries a filled-in text");
  same(codes(warningsFor("artist", rows(artistRow()), facts())), [], "a complete artist on a clean build has nothing to warn about");
  same(
    codes(warningsFor("artist", rows(artistRow({ image_url: null, art_image_url: null })), facts())),
    [],
    "no_cutout is for an artist WITH a photo and no cut-out; no photo at all is not that warning",
  );

  // An artist with no page: that single warning, no cut-out / gallery noise.
  const noArtist = warningsFor("artist", rows(null), facts());
  same(codes(noArtist), ["no_artist_page"], "artist row null -> no_artist_page only");
  same(noArtist[0].fix_url, "/templates/artists", "no_artist_page links the artists list (there is no row id to open)");

  // Bio and category twin.
  const bare = warningsFor("artist", rows(artistRow({ bio: null, hasTwin: false })), facts());
  same(codes(bare), ["no_bio", "no_category_twin"], "no bio + no /c/ twin");
  same(bare[0].fix_url, "/templates/artists/7/edit#fix-bio", "no_bio deep-links #fix-bio");
  check(bare[1].fix_url === undefined, "no_category_twin is information only - no fix_url");
  for (const empty of ["", "   ", [], {}]) {
    same(codes(warningsFor("artist", rows(artistRow({ bio: empty })), facts())), ["no_bio"], `an empty bio (${JSON.stringify(empty)}) counts as no bio`);
  }

  // Teams.
  same(
    codes(warningsFor("team", rows(null, teamRow({ logo_url: null, crestInLibrary: false })), facts())),
    ["no_crest"],
    "team without logo and not in the library -> no_crest",
  );
  same(
    warningsFor("team", rows(null, teamRow({ name: "Atlético Madrid", logo_url: null, crestInLibrary: false })), facts())[0].fix_url,
    "/assets?q=Atl%C3%A9tico%20Madrid",
    "no_crest links the assets library, searched by the team name",
  );
  same(codes(warningsFor("team", rows(null, teamRow({ logo_url: null, crestInLibrary: true })), facts())), [], "a crest that is in the library is not missing");
  same(codes(warningsFor("team", rows(null, teamRow({ logo_url: "  " , crestInLibrary: true })), facts())), [], "a blank logo with the crest in the library is fine");
  const noTeam = warningsFor("team", rows(null, null), facts());
  same(codes(noTeam), ["no_team_page"], "team row null -> no_team_page only");
  same(noTeam[0].fix_url, "/templates/football", "no_team_page links the football list");
  const teamBare = warningsFor("team", rows(null, teamRow({ bio: null, hasTwin: false })), facts());
  same(codes(teamBare), ["no_bio", "no_category_twin"], "a team without bio / twin");
  same(teamBare[0].fix_url, "/templates/football/9/edit#fix-bio", "a team's bio deep-links the football form");
  same(codes(warningsFor("team", rows(artistRow({ art_image_url: null }), teamRow()), facts())), [], "a team run reads the team row, never the artist row");
  same(codes(warningsFor("artist", rows(artistRow(), teamRow({ logo_url: null, crestInLibrary: false })), facts())), [], "an artist run reads the artist row, never the team row");

  // A competition has no page of its own: nothing to warn about unless the caller hands a team row.
  same(codes(warningsFor("competition", rows(null, null), facts())), [], "competition with no team row -> no subject warnings (no page to be missing)");
  same(
    codes(warningsFor("competition", rows(null, teamRow({ logo_url: null, crestInLibrary: false })), facts())),
    ["no_crest"],
    "competition with a team row is checked like a team",
  );

  // Facts.
  const venue = warningsFor("artist", rows(artistRow()), facts({ newVenue: true, unzoned: 3 }));
  same(codes(venue), ["new_venue"], "newVenue + unzoned 3 -> new_venue only (the unzoned tickets are implied)");
  same(venue[0].text, "אולם חדש - אין תבנית זונים; הכרטיסים יעלו בלי זונים", "new_venue uses the spec's text");
  const unzoned = warningsFor("artist", rows(artistRow()), facts({ unzoned: 3, totalTickets: 12 }));
  same(codes(unzoned), ["unzoned_tickets"], "a known venue with unzoned tickets -> unzoned_tickets");
  check(unzoned[0].text.includes("3") && unzoned[0].text.includes("12"), "unzoned_tickets names how many of how many");
  same(codes(warningsFor("artist", rows(artistRow()), facts({ unzoned: 0 }))), [], "nothing unzoned, nothing said");

  const unreach = warningsFor("artist", rows(artistRow()), facts({ suppliersUsed: ["tixstock"], unreachable: ["livetickets"] }));
  same(codes(unreach), ["supplier_unreachable"], "unreachable livetickets -> supplier_unreachable (and not single_supplier: the other supplier never answered)");
  same(unreach[0].text, "LiveTickets לא ענה - האירוע נבנה בלי Live; צרפו ידנית", "supplier_unreachable uses the spec's LiveTickets text");
  same(
    warningsFor("artist", rows(artistRow()), facts({ suppliersUsed: ["livetickets"], unreachable: ["tixstock"] }))[0].text,
    "TixStock לא ענה - האירוע נבנה בלי TixStock; צרפו ידנית",
    "the same line for TixStock",
  );
  same(
    codes(warningsFor("artist", rows(artistRow()), facts({ suppliersUsed: [], unreachable: ["tixstock", "livetickets"] }))),
    ["supplier_unreachable", "supplier_unreachable"],
    "one warning per supplier that did not answer",
  );
  const single = warningsFor("artist", rows(artistRow()), facts({ suppliersUsed: ["tixstock"] }));
  same(codes(single), ["single_supplier"], "only TixStock sells it -> single_supplier");
  check(single[0].text.includes("TixStock") && !single[0].text.includes("LiveTickets"), "single_supplier names the supplier that sells it");
  check(warningsFor("artist", rows(artistRow()), facts({ suppliersUsed: ["livetickets"] }))[0].text.includes("LiveTickets"), "single_supplier names LiveTickets when that is the one");
  same(codes(warningsFor("artist", rows(artistRow()), facts({ hebrewName: false }))), ["no_hebrew_name"], "no Hebrew name found -> no_hebrew_name");

  const far = warningsFor("artist", rows(artistRow()), facts({ farVenue: { id: 4, city: "London", km: 312.4 } }));
  same(codes(far), ["far_venue"], "a far venue -> far_venue");
  check(far[0].text.includes('312 ק"מ'), "far_venue puts the (rounded) km in the text");
  check(far[0].text.includes('בנה כחבילה דרך London (312 ק"מ) עם פיצול מלון'), "far_venue carries the spec's offer text verbatim");
  same(farVenueOffer("London", 312.4), 'בנה כחבילה דרך London (312 ק"מ) עם פיצול מלון', "farVenueOffer is the spec's button text");
  check(far[0].fix_url === undefined, "far_venue has no fix_url - the board gives it its own action button");

  // Order: the subject's own pages first, then what the build found.
  const everything = warningsFor(
    "artist",
    rows(artistRow({ art_image_url: null, event_gallery: [], bio: null, hasTwin: false })),
    facts({
      newVenue: true,
      suppliersUsed: ["tixstock"],
      unreachable: ["livetickets"],
      hebrewName: false,
      farVenue: { id: 4, city: "London", km: 400 },
    }),
  );
  same(
    codes(everything),
    ["no_cutout", "no_event_gallery", "no_bio", "no_category_twin", "new_venue", "supplier_unreachable", "no_hebrew_name", "far_venue"],
    "warnings come subject first, then the build's facts",
  );
  check(codes(everything).every((c) => c in WARNING_TEXT), "every code warningsFor emits has an entry in WARNING_TEXT");
  const allCodes = [
    ...codes(warningsFor("artist", rows(null), facts())),
    ...codes(warningsFor("team", rows(null), facts())),
    ...codes(warningsFor("team", rows(null, teamRow({ logo_url: null, crestInLibrary: false })), facts({ unzoned: 2, suppliersUsed: ["livetickets"] }))),
    ...codes(everything),
  ];
  check(allCodes.every((c) => typeof WARNING_TEXT[c] === "string" && WARNING_TEXT[c] !== ""), "WARNING_TEXT has a non-empty text for each of them");

  // -- decisions.ts --------------------------------------------------------------------------
  same(
    Object.keys(DECISION_TEXT).sort(),
    [
      "base_prices",
      "categories_dropped",
      "dates_smart",
      "duplicate_dropped",
      "live_from_snapshot",
      "location_found",
      "location_missing_ticket_only",
      "lodging_from_memory",
      "prior_answer",
      "rejected_before",
      "tickets_livetickets",
      "tickets_tixstock",
      "tribute_excluded",
      "two_city_chosen",
      "two_city_from_memory",
      "zones_from_template",
    ],
    "the decision codes: spec 9.9 + two_city_from_memory / two_city_chosen / rejected_before",
  );
  same(decision("dates_smart", { depart: "18.05", ret: "21.05" }), { code: "dates_smart", text: "טיסות 18.05 → 21.05" }, "dates_smart: the spec's text");
  same(decision("base_prices", { flight: 310, hotel: 290 }).text, "בסיס מהכלל: טיסה $310 · מלון $290", "base_prices: the spec's text");
  same(
    decision("categories_dropped", { count: 3, reason: "restricted view" }),
    { code: "categories_dropped", text: "3 קטגוריות restricted view הושמטו" },
    "categories_dropped: the spec's text",
  );
  same(decision("categories_dropped", { count: 1, reason: "restricted view" }).text, "קטגוריה אחת restricted view הושמטה", "categories_dropped: one category reads as one");
  same(decision("prior_answer", { name: "דור", run: 3 }).text, "לפי תשובה קודמת של דור (ריצה #3)", "prior_answer: the spec's 8.4 text");
  same(
    decision("two_city_from_memory", { event: "Oasis - Manchester", show_city: "מנצ'סטר", flight_city: "לונדון" }).text,
    "דו-עירוני כמו Oasis - Manchester: הופעה במנצ'סטר, טיסה ללונדון, פיצול מלון",
    "two_city_from_memory: the spec's text",
  );
  same(
    decision("two_city_from_memory", { event: "Oasis - Manchester", show_city: "Manchester", flight_city: "London" }).text,
    "דו-עירוני כמו Oasis - Manchester: הופעה ב-Manchester, טיסה ל-London, פיצול מלון",
    "two_city_from_memory: a Latin city name takes a hyphen after the Hebrew prefix",
  );
  same(
    decision("two_city_from_memory", { event: "E", show_city: "Manchester", flight_city: "London", lodging: "בחירת עיר לינה" }).text,
    "דו-עירוני כמו E: הופעה ב-Manchester, טיסה ל-London, בחירת עיר לינה",
    "two_city_from_memory: the lodging words follow the memory when the caller names them",
  );
  same(
    decision("two_city_chosen", { show_city: "Manchester", flight_city: "London", km: 262 }).text,
    'דו-עירוני לפי בחירת צוות: הופעה ב-Manchester, טיסה ל-London (262 ק"מ), פיצול מלון',
    "two_city_chosen: show city, flight city and the distance staff accepted",
  );
  same(
    decision("two_city_chosen", { show_city: "Örebro", flight_city: "İstanbul", km: 261.6789 }).text,
    'דו-עירוני לפי בחירת צוות: הופעה ב-Örebro, טיסה ל-İstanbul (262 ק"מ), פיצול מלון',
    "an accented Latin initial still takes the hyphen, and a float km prints rounded",
  );
  same(
    decision("location_found", { city: "London", iata: "LON", km: 12.3456 }).text,
    'מיקום: London (LON), 12 ק"מ מהאולם',
    "location_found prints the km rounded",
  );
  const samples: Record<keyof typeof DECISION_TEXT, Record<string, string | number>> = {
    location_found: { city: "London", iata: "LON", km: 12 },
    location_missing_ticket_only: {},
    tickets_tixstock: { count: 4 },
    tickets_livetickets: { count: 2 },
    live_from_snapshot: { count: 2 },
    categories_dropped: { count: 2, reason: "restricted view" },
    zones_from_template: { zoned: 9, total: 12 },
    dates_smart: { depart: "18.05", ret: "21.05" },
    base_prices: { flight: 310, hotel: 290 },
    prior_answer: { name: "דור", run: 2 },
    lodging_from_memory: { event: "Oasis - Manchester" },
    tribute_excluded: { name: "Journeyman - A Tribute to Eric Clapton" },
    duplicate_dropped: { name: "Eric Clapton", event_id: 812 },
    two_city_from_memory: { event: "Oasis", show_city: "Manchester", flight_city: "London" },
    two_city_chosen: { show_city: "Manchester", flight_city: "London", km: 262 },
    rejected_before: { run: 3, by: "Alon", reason: "מחיר שגוי" },
  };
  for (const code of Object.keys(DECISION_TEXT) as (keyof typeof DECISION_TEXT)[]) {
    const d = decision(code, samples[code]);
    check(d.code === code && d.text.length > 0, `${code}: a decision with its own code and a text`);
    check(!/[{}]|undefined|NaN|null/.test(d.text), `${code}: the text is fully filled in ("${d.text}")`);
    check(!/[{}]|undefined|NaN|null/.test(decision(code).text), `${code}: a missing param never prints "undefined"`);
  }
  check(decision("location_found", samples.location_found).text.includes("London") && decision("location_found", samples.location_found).text.includes("12"), "location_found names the city and the distance");
  check(decision("tickets_tixstock", { count: 1 }).text.includes("קטגוריה אחת"), "tickets_tixstock: one category reads as one");
  check(decision("rejected_before", { run: 3, by: "Alon", reason: "מחיר שגוי" }).text.includes("מחיר שגוי"), "rejected_before quotes the reason staff gave");

  // editDiff.
  same(
    [...EDIT_WHITELIST],
    [
      "name",
      "name_english",
      "date",
      "def_date_depart",
      "def_date_return",
      "base_flight_price",
      "base_hotel_price",
      "event_additional_markup",
      "ticket_only_markup",
      "package_mode",
      "location",
      "event_location",
      "lodging_mode",
      "lodging_default",
      "split_default_nights",
      "tickets_count",
    ],
    "the edit whitelist is the brief's",
  );
  const built = {
    name: "ליברפול - קריסטל פאלאס",
    name_english: "Liverpool FC vs Crystal Palace FC",
    description: "built text",
    is_hidden: true,
    base_flight_price: 310,
    base_hotel_price: 290,
    location: { name: "London", city_iata: "LON", latitude: 51.5, longitude: -0.12 },
    tickets_and_rates: Array.from({ length: 12 }, (_, i) => ({ id: `t${i}` })),
  };
  same(editDiff(built, { ...built, description: "staff text", is_hidden: false, id: 5 }), [], "fields outside the whitelist are not edits");
  same(
    editDiff(built, { ...built, tickets_and_rates: built.tickets_and_rates.slice(0, 11) }),
    [{ field: "tickets_count", from: 12, to: 11 }],
    "tickets_count: 12 -> 11 when staff removed a category",
  );
  same(
    editDiff(built, { ...built, base_flight_price: 350, name: "ליברפול נגד קריסטל פאלאס" }),
    [
      { field: "name", from: "ליברפול - קריסטל פאלאס", to: "ליברפול נגד קריסטל פאלאס" },
      { field: "base_flight_price", from: 310, to: 350 },
    ],
    "several edits come back in whitelist order",
  );
  same(
    editDiff(built, { ...built, location: { latitude: 51.5, longitude: -0.12, city_iata: "LON", name: "London" } }),
    [],
    "a location stored by jsonb (other key order) is the same location",
  );
  same(
    editDiff(built, { ...built, location: { ...built.location, city_iata: "MAN" } }),
    [{ field: "location", from: built.location, to: { ...built.location, city_iata: "MAN" } }],
    "an object field that really changed is reported whole",
  );
  same(
    editDiff({ ...built, event_location: null }, { ...built, event_location: { name: "Manchester" } }),
    [{ field: "event_location", from: null, to: { name: "Manchester" } }],
    "event_location null -> set is an edit",
  );
  same(editDiff({ ...built, event_location: null }, { ...built, event_location: null }), [], "null against null is no edit");
  same(editDiff(built, null), [], "no live row (deleted?) -> nothing to diff");
  same(editDiff(null, built), [], "no stored payload -> nothing to diff against");
  same(
    editDiff(built, { ...built, lodging_mode: "flight_city", split_default_nights: 1 }),
    [],
    "a column the builder never set (DB default on the row) is not an edit",
  );
  same(
    editDiff({ ...built, tickets_and_rates: null }, { ...built, tickets_and_rates: [] }),
    [],
    "tickets_count: no list and an empty list are both zero",
  );

  // -- names.ts ------------------------------------------------------------------------------
  const match = (over: Partial<ShowIdentity> = {}): ShowIdentity => ({
    name_english: "Liverpool FC vs Crystal Palace FC",
    city: "Liverpool",
    country_code: "GB",
    venue: "Anfield",
    date: "2027-03-06",
    lat: 53.43,
    lon: -2.96,
    suppliers: { tixstock: null, livetickets: null },
    competition: "Premier League",
    home_team: "Liverpool FC",
    away_team: "Crystal Palace FC",
    fallback: [],
    ...over,
  });
  const teamsHe = { "liverpool fc": "ליברפול", "crystal palace fc": "קריסטל פאלאס", "atletico madrid": "אתלטיקו מדריד" };
  const noSubject = { name_en: "Liverpool FC", name_he: "ליברפול" };
  same(
    eventNames("team", match(), noSubject, teamsHe, null),
    { name: "ליברפול - קריסטל פאלאס", name_english: "Liverpool FC vs Crystal Palace FC", hebrew: true },
    "football: Hebrew names of both sides, TixStock's English name",
  );
  same(
    eventNames("team", match({ away_team: "Brighton & Hove Albion FC" }), noSubject, teamsHe, null),
    { name: "Liverpool FC vs Crystal Palace FC", name_english: "Liverpool FC vs Crystal Palace FC", hebrew: false },
    "football with one side unknown -> the English name, hebrew false",
  );
  same(
    eventNames("team", match({ home_team: null, away_team: null }), noSubject, teamsHe, null),
    { name: "Liverpool FC vs Crystal Palace FC", name_english: "Liverpool FC vs Crystal Palace FC", hebrew: false },
    "football with no sides read -> the English name",
  );
  same(
    eventNames("team", match({ home_team: "Atlético Madrid", away_team: "Liverpool FC", name_english: "Atlético Madrid vs Liverpool FC" }), noSubject, teamsHe, null).name,
    "אתלטיקו מדריד - ליברפול",
    "the lookup is by normalizeName: accents do not break it",
  );
  same(
    eventNames("team", match(), noSubject, { ...teamsHe, "crystal palace fc": "  " }, null),
    { name: "Liverpool FC vs Crystal Palace FC", name_english: "Liverpool FC vs Crystal Palace FC", hebrew: false },
    "a blank Hebrew name in the table is not a name",
  );
  same(
    eventNames("competition", match(), { name_en: "Premier League", name_he: null }, teamsHe, null),
    { name: "ליברפול - קריסטל פאלאס", name_english: "Liverpool FC vs Crystal Palace FC", hebrew: true },
    "a competition run names its fixtures like a team run",
  );

  const clapton = { name_en: "Eric Clapton", name_he: "אריק קלפטון" };
  const festival = match({ name_english: "Eric Clapton Live 2027", home_team: null, away_team: null });
  same(
    eventNames("artist", festival, clapton, teamsHe, null),
    { name: "אריק קלפטון", name_english: "Eric Clapton", hebrew: true },
    "music: the artist row's Hebrew name and the performer's English name (not the supplier's title)",
  );
  same(
    eventNames("artist", festival, { name_en: "Eric Clapton", name_he: null }, teamsHe, "אריק קלפטון (לייב)"),
    { name: "אריק קלפטון (לייב)", name_english: "Eric Clapton", hebrew: true },
    "music: no Hebrew on the row -> LiveTickets' hebName",
  );
  same(
    eventNames("artist", festival, clapton, teamsHe, "שם אחר"),
    { name: "אריק קלפטון", name_english: "Eric Clapton", hebrew: true },
    "music: the artist row's Hebrew name beats Live's",
  );
  same(
    eventNames("artist", festival, { name_en: "Eric Clapton", name_he: null }, teamsHe, null),
    { name: "Eric Clapton", name_english: "Eric Clapton", hebrew: false },
    "music: no Hebrew anywhere -> the English name, hebrew false",
  );
  same(
    eventNames("artist", festival, { name_en: "Eric Clapton", name_he: "  " }, teamsHe, " "),
    { name: "Eric Clapton", name_english: "Eric Clapton", hebrew: false },
    "music: blank strings are not names",
  );
}

// ---- Task 7: nearest location (lib/services/nearest-location.ts findNearestLocation) ----------
{
  const loc = (id: number, name: string, iata: string | null, lat: number, lon: number): LocationRow => ({
    id,
    name,
    city_iata: iata,
    latitude: lat,
    longitude: lon,
    country_code: null,
  });
  // Royal Albert Hall; London (LON) ~4 km, Luton-ish (LTN) ~48 km, a named place with no iata ~1 km.
  const venue = { lat: 51.501269, lon: -0.177516 };
  const london = loc(4, "London", "LON", 51.509865, -0.118092);
  const luton = loc(50, "Luton", "LTN", 51.8787, -0.4200);
  const kensington = loc(60, "Kensington", null, 51.4990, -0.1938);
  const blankIata = loc(61, "Chelsea", "", 51.4875, -0.1687);
  const liverpool = loc(31, "Liverpool", null, 53.4084, -2.9916);

  const near = findNearestLocation(venue.lat, venue.lon, [luton, london, kensington, blankIata], NEAR_LOCATION_KM);
  same(near?.row.id, 4, "within 50 km the nearest row WITH an iata wins (London over Luton)");
  check(near !== null && near.km > 3 && near.km < 6, `the distance comes back in km (${near?.km})`);
  same(
    findNearestLocation(venue.lat, venue.lon, [kensington, blankIata, luton], NEAR_LOCATION_KM)?.row.id,
    50,
    "a nearer row without an iata (null or blank) is skipped",
  );
  same(findNearestLocation(venue.lat, venue.lon, [kensington, liverpool], NEAR_LOCATION_KM), null, "no row with an iata in range -> null");
  same(findNearestLocation(venue.lat, venue.lon, [], NEAR_LOCATION_KM), null, "no rows -> null");
  same(findNearestLocation(venue.lat, venue.lon, [luton], 30), null, "a row beyond maxKm is not near");
  same(findNearestLocation(venue.lat, venue.lon, [london, luton], FAR_VENUE_KM)?.row.id, 4, "a wider radius still picks the nearest");
  // Anfield: London is ~280 km - beyond NEAR, within FAR (the far-venue offer's range).
  const anfield = findNearestLocation(53.4308, -2.9608, [london, liverpool], FAR_VENUE_KM);
  check(anfield?.row.id === 4 && anfield.km > NEAR_LOCATION_KM && anfield.km < FAR_VENUE_KM, `Anfield -> London ${anfield?.km} km, in the far-venue range`);
  same(findNearestLocation(53.4308, -2.9608, [london, liverpool], NEAR_LOCATION_KM), null, "Anfield has no package location within 50 km");
  same(
    findNearestLocation(venue.lat, venue.lon, [loc(70, "Twin A", "AAA", 51.509865, -0.118092), loc(71, "Twin B", "BBB", 51.509865, -0.118092)], NEAR_LOCATION_KM)?.row.id,
    70,
    "two rows at the same distance -> the first listed (stable)",
  );
}

// ---- Task 7 pre-review fixes: competition-prefixed fixtures, LiveTickets test rows, ticket-only markup blocker
{
  const NOW = new Date("2026-10-21T09:00:00Z");
  const liverpool: Subject = { kind: "team", name_en: "Liverpool FC", name_he: "ליברפול", aliases: ["Liverpool", "ליברפול"] };
  const plan = (homeOnly: boolean): UploaderPlan => {
    const p = emptyPlan();
    p.subject = { kind: "team", name_he: "ליברפול", name_en: "Liverpool FC" };
    p.scope.home_only = homeOnly;
    return p;
  };
  const tix = (event_id: string, event_name: string, performers: string[], show_date = "2026-12-09T20:00:00+00:00"): TixRow => ({
    event_id,
    event_name,
    show_date,
    venue_name: "Anfield",
    city_name: "Liverpool",
    country_code: "GB",
    performers: performers.map((name) => ({ name })),
    category_name: "UEFA Champions League",
    sub_category_name: "Champions League",
    ticket_count: 2072,
    venue_map_url: null,
    lat: 53.4308,
    lon: -2.9608,
  });
  const live = (event_id: number, event_name: string, performers: string[], show_date = "2026-12-09T20:00:00+00:00"): LiveRow => ({
    event_id,
    event_name,
    event_name_heb: null,
    show_date,
    city_name: "Liverpool",
    country_name: "United Kingdom",
    performers: performers.map((name) => ({ name })),
    event_type: "sports_live_event_dynamic",
    sellable: 10,
  });

  // 1. "<competition> - <A> vs <B>": the sides come from the segment that holds " vs ".
  const porto = tix("tx-uefa-porto", "UEFA Champions League - Liverpool FC vs FC Porto", ["Liverpool FC", "FC Porto"]);
  same(tixMatchesSubject(porto, liverpool, plan(true).scope), "match", "competition prefix: Liverpool opens the fixture -> a home match, not away");
  const portoLive = live(2327309, "Champions League: Liverpool vs FC Porto", ["Liverpool", "FC Porto"]);
  const prefixed = groupRows([porto], [portoLive], liverpool, plan(true), NOW);
  same(
    prefixed.shows.map((s) => [s.home_team, s.away_team, s.suppliers.tixstock?.event_id ?? null, s.suppliers.livetickets?.event_id ?? null]),
    [["Liverpool FC", "FC Porto", "tx-uefa-porto", 2327309]],
    "competition prefix: home Liverpool FC, away FC Porto, LiveTickets paired on the same show",
  );
  same(prefixed.excluded, [], "competition prefix: neither row is excluded as away");
  const plain = tix("tx-lfc-porto", "Liverpool FC vs FC Porto", ["Liverpool FC", "FC Porto"]);
  same(tixMatchesSubject(plain, liverpool, plan(true).scope), "match", "a plain 'A vs B' name is unchanged");
  same(
    groupRows([plain], [], liverpool, plan(true), NOW).shows.map((s) => [s.home_team, s.away_team]),
    [["Liverpool FC", "FC Porto"]],
    "a plain 'A vs B' name keeps its sides",
  );
  const tail = tix("tx-lfc-porto-tail", "Liverpool FC vs FC Porto - Champions League", ["Liverpool FC", "FC Porto"]);
  same(
    groupRows([tail], [], liverpool, plan(true), NOW).shows.map((s) => [s.home_team, s.away_team]),
    [["Liverpool FC", "FC Porto"]],
    "a competition TAIL still drops off the away side",
  );
  same(
    tixMatchesSubject(tix("tx-uefa-brugge", "UEFA Champions League - Club Brugge vs Liverpool FC", ["Club Brugge", "Liverpool FC"]), liverpool, plan(true).scope),
    "away",
    "competition prefix: an away fixture stays away",
  );
  same(
    tixMatchesSubject(tix("tx-lfc-training", "Liverpool FC - Open Training", ["Liverpool FC"]), liverpool, plan(true).scope),
    "match",
    "a name with ' - ' and no ' vs ' behaves as before (the name opens with the team)",
  );
  same(
    tixMatchesSubject(tix("tx-tour", "Stadium Tour - Liverpool FC", ["Liverpool FC"]), liverpool, plan(true).scope),
    "away",
    "a name with ' - ' and no ' vs ' that does not open with the team stays not-home, as before",
  );

  // 2. A LiveTickets test row (a "test" word, no " vs ") is excluded as test_row - with no question and no show.
  const testRow = live(1777069, "liverpool test 3", ["Liverpool"], "2028-06-15T20:00:00+00:00");
  const tested = groupRows([], [testRow], liverpool, plan(true), NOW);
  same(tested.shows, [], "test row: no show");
  same(tested.excluded, [{ row: "livetickets", id: "1777069", reason: "test_row" }], "test row: excluded as test_row");
  const vsTest = live(1777070, "Liverpool vs Test XI", ["Liverpool", "Test XI"], "2028-06-16T20:00:00+00:00");
  const real = groupRows([], [vsTest], liverpool, plan(true), NOW);
  same(real.shows.map((s) => s.suppliers.livetickets?.event_id ?? null), [1777070], "a fixture with 'test' AND ' vs ' is a real show");
  same(real.excluded, [], "a fixture with 'test' AND ' vs ' is not excluded");
  same(
    groupRows([], [live(1777071, "Contest Night", ["Liverpool"], "2028-06-17T20:00:00+00:00")], liverpool, plan(true), NOW).excluded,
    [],
    "'test' must be a whole word ('Contest' is not a test row)",
  );

  // 3. The ticket-only markup blocker text sits beside no_base_price.
  same(
    WARNING_TEXT.no_ticket_only_markup,
    "אין מארק-אפ לכרטיס בלבד - מלאו בעורך לפני האישור",
    "no_ticket_only_markup: the blocker's text",
  );
  check(!!WARNING_TEXT.no_base_price && !!WARNING_TEXT.no_base_price_hotel, "no_base_price: flight and hotel blocker texts exist");
}

// ---- Task 7 search patterns + window (lib/services/uploader-search.ts) ------------------------
{
  const NOW = new Date("2026-10-21T09:00:00Z");
  const artist = (name_en: string, name_he: string | null = null): Subject => ({ kind: "artist", name_en, name_he, aliases: [] });
  same(subjectPatterns(artist("Jay-Z")).latin, ["%jay%z%"], "Jay-Z: the hyphen splits the name into fragments, nothing is glued");
  same(subjectPatterns(artist("AC/DC")).latin, ["%ac%dc%"], "AC/DC: the slash splits");
  same(subjectPatterns(artist("P!nk")).latin, ["%p%nk%"], "P!nk: the mark splits");
  same(subjectPatterns(artist("O'Connor")).latin, ["%o%connor%"], "O'Connor: a Latin apostrophe splits");
  same(subjectPatterns(artist("Beyoncé")).latin, ["%beyonc_%"], "an accented letter is one `_` (Beyonce / Beyoncé)");
  same(subjectPatterns(artist("Chelsea", "צ'לסי")).hebrew, ["%צ_לסי%"], "a Hebrew geresh stays inside the word as `_` (matches ' and ׳)");
  same(nameFragments("צ׳לסי - ברנטפורד"), ["צ_לסי", "ברנטפורד"], "the Hebrew geresh sign too; the dash splits");
  same(subjectPatterns({ kind: "team", name_en: "Liverpool FC", name_he: "ליברפול", aliases: ["Liverpool"] }).latin, ["%liverpool%"], "a team searches by its club tokens");
  const hostile = subjectPatterns(artist('Foo, (Bar) "Baz" % * \\ .'), ["x,y(z)", "%%", "*"]);
  same(hostile.latin, ["%foo%bar%baz%", "%x%y%z%"], "a hostile name gives only its letter fragments");
  check(
    [...hostile.latin, ...hostile.hebrew].every((p) => /^[%_\p{L}\p{N}]+$/u.test(p)),
    "every pattern holds letters, digits, % and _ only (nothing PostgREST .or() parses)",
  );
  same(nameFragments("!!!"), [], "a name with no letter has no fragment");

  const scope = (date_from: string | null, date_to: string | null): UploaderPlan["scope"] => ({ ...emptyPlan().scope, date_from, date_to });
  same(searchWindow(scope(null, null), NOW), { from: "2026-10-23", to: "2028-10-24" }, "open window: today+3 (one day wider) to its start + 24 months");
  same(
    searchWindow(scope("2029-03-01", null), NOW),
    { from: "2029-02-28", to: "2031-03-01" },
    "a date_from more than 24 months ahead with no date_to: the cap counts from the start, never an empty window",
  );
  check(tixSlices(searchWindow(scope("2029-03-01", null), NOW)).length > 0, "...so it has slices to read");
  same(searchWindow(scope("2027-05-01", "2027-06-30"), NOW), { from: "2027-04-30", to: "2027-07-02" }, "a dated window, one day wider each side (to exclusive)");
  same(searchWindow(scope("2026-10-01", null), NOW).from, "2026-10-23", "a date_from before the floor starts at the floor");
  same(
    tixSlices({ from: "2026-10-23", to: "2027-03-01" }),
    [
      { from: "2026-10-23", to: "2027-02-20" },
      { from: "2027-02-20", to: "2027-03-01" },
    ],
    "120-day slices, the last one cut at the window's end",
  );
  same(tixSlices(searchWindow(scope(null, null), NOW)).length, 7, "an open window = 7 slices (read 3 at a time)");
}

// ---- Task 7 place (lib/uploader/place.ts decidePlace) - every branch, in the spec's order ---------
{
  const NOW = new Date("2026-10-21T09:00:00Z");
  const loc = (id: number, name: string, iata: string | null, lat: number, lon: number): LocationRow => ({
    id,
    name,
    city_iata: iata,
    latitude: lat,
    longitude: lon,
    country_code: null,
  });
  const london = loc(4, "לונדון, בריטניה", "LON", 51.509865, -0.118092);
  const munich = loc(11, "מינכן, גרמניה", "MUC", 48.1549958, 11.6242359);
  const liverpoolCity = loc(31, "ליברפול", null, 53.4084, -2.9916);
  const manchester = loc(32, "מנצ'סטר", null, 53.4808, -2.2426);
  const munichTwin = loc(30, "מינכן, גרמניה", "MUC", 48.1371775, 11.5629453);
  const paris = loc(6, "Paris, France", "CDG", 48.864716, 2.349014);
  const rows = [london, munich, liverpoolCity, manchester, munichTwin, paris];

  const show = (over: Partial<ShowIdentity> = {}): ShowIdentity => ({
    name_english: "Eric Clapton London",
    city: "London",
    country_code: "GB",
    venue: "London Royal Albert Hall",
    date: "2027-05-20",
    lat: 51.501269,
    lon: -0.177516,
    suppliers: {
      tixstock: { event_id: "tx-rah", name: "Eric Clapton London", ticket_count: 120, venue_map_url: "https://tixstock.example/rah.svg" },
      livetickets: null,
    },
    competition: null,
    home_team: null,
    away_team: null,
    fallback: [],
    ...over,
  });
  const anfield = show({ name_english: "Liverpool FC vs FC Porto", city: "Liverpool", venue: "Anfield", lat: 53.4308, lon: -2.9608, home_team: "Liverpool FC", away_team: "FC Porto" });
  const liveOnly = show({
    venue: null,
    lat: null,
    lon: null,
    suppliers: { tixstock: null, livetickets: { event_id: 2327792, name_heb: "אריק קלפטון", sellable: 3 } },
  });
  const tixNoCoords = show({ lat: null, lon: null });
  const input = (over: Partial<PlaceInput> = {}): PlaceInput => ({
    show: show(),
    subject_en: "Eric Clapton",
    rows,
    withoutLocation: "ticket_only",
    twoCity: null,
    answer: null,
    prior: null,
    liveCity: null,
    memory: null,
    now: NOW,
    ...over,
  });
  const codesOf = (r: ReturnType<typeof decidePlace>): string[] => (r.kind === "error" ? [] : r.decisions.map((d) => d.code));
  const manchesterLodging = { event_location: { name: "מנצ'סטר", latitude: 53.4808, longitude: -2.2426 }, lodging_mode: "choice_split" as const, lodging_default: "event" as const, lodging_note: null, split_default_nights: 2 };

  same(SPLIT_DEFAULT_NIGHTS, 2, "SPLIT_DEFAULT_NIGHTS is what lib/lodging.ts defaultSplit gives an unset value");

  // 1. two-city chosen by staff
  const two = decidePlace(input({ show: anfield, twoCity: { flightCityId: 4 } }));
  check(two.kind === "placed" && two.mode === "package" && two.location.city_iata === "LON", "two-city: a package flying to the chosen row");
  check(
    two.kind === "placed" &&
      two.lodging.lodging_mode === "choice_split" &&
      two.lodging.lodging_default === "event" &&
      two.lodging.split_default_nights === 2 &&
      two.lodging.event_location?.name === "ליברפול",
    "two-city: split lodging, the venue city in the site's own spelling (a location row with no IATA)",
  );
  check(two.kind === "placed" && two.itemLocation?.id === 4 && two.itemLocation.far === true, "two-city: item.location = the flight city, far");
  same(codesOf(two), ["two_city_chosen"], "two-city: decision two_city_chosen");
  same(decidePlace(input({ show: anfield, twoCity: { flightCityId: 31 } })).kind, "error", "two-city: a row with no IATA is an error, never a guess");
  same(decidePlace(input({ show: liveOnly, twoCity: { flightCityId: 4 } })).kind, "error", "two-city: no venue coordinates is an error");

  // 2. the item's own answer
  const answered = decidePlace(input({ show: liveOnly, answer: { key: "4", text: null } }));
  check(answered.kind === "placed" && answered.location.city_iata === "LON" && answered.itemLocation?.far === false, "answer: the chosen location is the package");
  check(answered.kind === "placed" && answered.decisions[0]?.text === "מיקום: לונדון (LON)", "answer: location_found with no distance when the venue has no coordinates");
  check(decidePlace(input({ show: liveOnly, answer: { key: "skip", text: null } })).kind === "skip", "answer skip -> skip");
  const skippedAnswer = decidePlace(input({ show: liveOnly, answer: { key: "skip", text: null } }));
  check(skippedAnswer.kind === "skip" && skippedAnswer.reason === "skipped_by_answer", "answer skip -> skipped_by_answer");
  same(decidePlace(input({ show: liveOnly, answer: { key: "999", text: null } })).kind, "ask", "answer naming no location -> ask again (never throws)");
  const typed = decidePlace(input({ show: liveOnly, answer: { key: null, text: "lon" } }));
  check(typed.kind === "placed" && typed.location.city_iata === "LON", "answer: a typed IATA finds the row");

  // 3. no venue coordinates
  const tixMemory = decidePlace(input({ show: tixNoCoords, memory: { fromEventName: "Oasis Manchester", lodging: manchesterLodging, flightIata: "LON" } }));
  same(codesOf(tixMemory), ["two_city_from_memory"], "no coords, TixStock show, no LiveTickets city: the venue memory's two-city setup");
  // The no-coordinates order, pinned: LiveTickets' city -> memory two-city -> earlier answer -> ask.
  const heathrow = loc(90, "Heathrow", "LHR", 51.47, -0.45);
  const liveFirst = decidePlace(
    input({ show: tixNoCoords, rows: [...rows, heathrow], liveCity: { iata: "LHR", city: "London" }, memory: { fromEventName: "Oasis Manchester", lodging: manchesterLodging, flightIata: "LON" }, prior: { key: "11", text: null, by: "Alon", run_no: 2 } }),
  );
  check(liveFirst.kind === "placed" && liveFirst.location.city_iata === "LHR" && liveFirst.lodging.lodging_mode === "choice_split", "order 1: LiveTickets' city is the package, the memory adds its lodging only");
  same(codesOf(liveFirst), ["location_found", "lodging_from_memory"], "order 1: location_found + lodging_from_memory (as on the with-coordinates path)");
  const memorySecond = decidePlace(
    input({ show: tixNoCoords, liveCity: { iata: "GB", city: "London" }, memory: { fromEventName: "Oasis Manchester", lodging: manchesterLodging, flightIata: "LON" }, prior: { key: "11", text: null, by: "Alon", run_no: 2 } }),
  );
  same(codesOf(memorySecond), ["two_city_from_memory"], "order 2: no LiveTickets city match -> the memory two-city beats an earlier answer");
  const priorThird = decidePlace(input({ show: tixNoCoords, liveCity: { iata: "GB", city: "London" }, prior: { key: "11", text: null, by: "Alon", run_no: 2 } }));
  check(priorThird.kind === "placed" && priorThird.location.city_iata === "MUC", "order 3: no city, no memory -> the earlier answer");
  same(decidePlace(input({ show: tixNoCoords, liveCity: { iata: "GB", city: "London" } })).kind, "ask", "order 4: nothing -> ask");

  // A retried item's own earlier event (lib/uploader/shows.ts ownEventToClean).
  check(ownEventToClean({ is_hidden: true, is_deleted: null }), "own event: hidden and not deleted -> clean it before rebuilding");
  check(ownEventToClean({ is_hidden: true, is_deleted: "" }), "own event: an empty is_deleted is not deleted");
  check(!ownEventToClean({ is_hidden: true, is_deleted: "10-21-2026" }), "own event: already deleted -> leave it");
  check(!ownEventToClean({ is_hidden: false, is_deleted: null }), "own event: live (approved) -> never deleted by a rebuild");
  check(!ownEventToClean({ is_hidden: null, is_deleted: null }), "own event: is_hidden unknown -> leave it");
  check(!ownEventToClean(null), "own event: gone -> nothing to clean");
  const byIata = decidePlace(input({ show: liveOnly, rows: [...rows, loc(90, "Heathrow", "LHR", 51.47, -0.45)], liveCity: { iata: "LHR", city: "London" } }));
  check(byIata.kind === "placed" && byIata.location.city_iata === "LHR", "no coords: LiveTickets' 3-letter iata finds the row");
  same(codesOf(byIata), ["location_found"], "no coords: a LiveTickets city match carries location_found");
  const byCity = decidePlace(input({ show: liveOnly, liveCity: { iata: "FR", city: "Paris" } }));
  check(byCity.kind === "placed" && byCity.location.city_iata === "CDG", "no coords: a 2-letter country code is not an airport - the city name matches");
  const noCity = { iata: "GB", city: "London" }; // Hebrew location names: no match
  const priorSkip = decidePlace(input({ show: liveOnly, liveCity: noCity, prior: { key: "skip", text: null, by: "Alon", run_no: 2 } }));
  check(priorSkip.kind === "skip" && priorSkip.reason === "skipped_by_answer", "no coords: an earlier run's skip skips (skipped_by_answer)");
  same(codesOf(priorSkip), ["prior_answer"], "no coords: the earlier answer is named");
  const priorHit = decidePlace(input({ show: liveOnly, liveCity: noCity, prior: { key: "4", text: null, by: "Alon", run_no: 2 } }));
  check(priorHit.kind === "placed" && priorHit.location.city_iata === "LON", "no coords: an earlier run's answer is applied");
  same(codesOf(priorHit), ["prior_answer", "location_found"], "no coords: prior_answer + location_found");
  same(decidePlace(input({ show: liveOnly, liveCity: noCity, prior: { key: "777", text: null, by: "Alon", run_no: 2 } })).kind, "ask", "no coords: an earlier answer naming no location -> ask");
  const asked = decidePlace(input({ show: liveOnly, liveCity: noCity }));
  check(asked.kind === "ask" && asked.question.kind === "pick_location" && asked.question.free_text, "no coords: otherwise ask pick_location, free text allowed");
  check(asked.kind === "ask" && asked.question.text.includes("LiveTickets"), "a LiveTickets-only question names LiveTickets");
  check(
    asked.kind === "ask" &&
      asked.question.options.filter((o) => o.label.includes("MUC")).length === 1 &&
      asked.question.options.at(-1)?.key === "skip" &&
      !asked.question.options.some((o) => o.key === "31"),
    "pick_location options: rows with an IATA, a repeated row once, skip last",
  );
  const tixAsked = decidePlace(input({ show: tixNoCoords }));
  check(tixAsked.kind === "ask" && !tixAsked.question.text.includes("LiveTickets"), "a TixStock show without coordinates is asked without claiming LiveTickets sells it");

  // 4. nearest location within NEAR
  const near = decidePlace(input());
  check(near.kind === "placed" && near.mode === "package" && near.location.city_iata === "LON" && near.itemLocation?.far === false, "near: London is the package, not far");
  same(codesOf(near), ["location_found"], "near: location_found");
  check(near.kind === "placed" && near.decisions[0].text.includes('ק"מ'), "near: the distance is printed");
  const nearMemory = decidePlace(input({ memory: { fromEventName: "Oasis RAH", lodging: manchesterLodging, flightIata: "LON" } }));
  same(codesOf(nearMemory), ["location_found", "lodging_from_memory"], "near + a memory naming a real second city: its lodging is copied");
  const sameCity = { ...manchesterLodging, event_location: { name: "לונדון", latitude: 51.509865, longitude: -0.118092 } };
  same(codesOf(decidePlace(input({ memory: { fromEventName: "X", lodging: sameCity, flightIata: "LON" } }))), ["location_found"], "near + a memory whose event city IS the flight city: nothing copied");

  // 5. memory two-city when no location is near
  const memo = decidePlace(input({ show: anfield, memory: { fromEventName: "Liverpool - Everton", lodging: manchesterLodging, flightIata: "LON" } }));
  check(memo.kind === "placed" && memo.mode === "package" && memo.lodging.lodging_mode === "choice_split", "memory: a two-city package like the last event at the venue");
  same(codesOf(memo), ["two_city_from_memory"], "memory: decision two_city_from_memory");
  same(
    decidePlace(input({ show: anfield, memory: { fromEventName: "X", lodging: manchesterLodging, flightIata: "XXX" } })).kind,
    "placed",
    "memory whose flight city is no location falls through to the plan's rule",
  );

  // 6. the plan's rule, with the nearest location within FAR as the offer
  const ticketOnly = decidePlace(input({ show: anfield }));
  check(ticketOnly.kind === "placed" && ticketOnly.mode === "ticket_only" && ticketOnly.location.city_iata === "", "rule ticket_only: built ticket-only at the venue");
  check(
    ticketOnly.kind === "placed" && ticketOnly.itemLocation?.id === 4 && ticketOnly.itemLocation.far === true && ticketOnly.farVenue?.id === 4,
    "ticket-only: item.location and farVenue hold the nearest location within FAR (the two-city default)",
  );
  same(codesOf(ticketOnly), ["location_missing_ticket_only"], "ticket-only: location_missing_ticket_only");
  const skipRule = decidePlace(input({ show: anfield, withoutLocation: "skip" }));
  check(skipRule.kind === "skip" && skipRule.reason === "no_location" && skipRule.itemLocation?.id === 4 && skipRule.farVenue?.city === "לונדון", "rule skip: no_location, with the far offer");
  const reykjavik = decidePlace(input({ show: show({ city: "Reykjavik", lat: 64.1466, lon: -21.9426 }) }));
  check(reykjavik.kind === "placed" && reykjavik.itemLocation === null && reykjavik.farVenue === null, "nothing within FAR: no offer, no item location");

  // helpers
  same(locationFromAnswer({ key: "11", text: null }, rows)?.id, 11, "locationFromAnswer: by id");
  same(locationFromAnswer({ key: "31", text: null }, rows), null, "locationFromAnswer: a row with no IATA is no answer");
  same(locationFromAnswer({ key: null, text: "מינכן" }, rows)?.id, 11, "locationFromAnswer: by the short name, first row");
  same(locationFromAnswer({ key: null, text: "  " }, rows), null, "locationFromAnswer: blank text");
  same(venueCity({ ...anfield, lat: 53.4308, lon: -2.9608 }, rows).name, "ליברפול", "venueCity: the nearest row of any kind within NEAR");
  same(
    venueCity({ ...anfield, city: "Reykjavik", lat: 64.1466, lon: -21.9426 }, rows),
    { name: "Reykjavik", latitude: 64.1466, longitude: -21.9426, country_code: "GB" },
    "venueCity: no row near -> the supplier's city at the venue coordinates",
  );
  same(
    withSupplierSpellings({ liverpool: "ליברפול", "crystal palace fc": "קריסטל פאלאס" }, ["Liverpool FC", "Crystal Palace FC", null, "Ipswich Town FC"]),
    { liverpool: "ליברפול", "crystal palace fc": "קריסטל פאלאס", "liverpool fc": "ליברפול" },
    "withSupplierSpellings: a supplier spelling gets its club's Hebrew name; unknown sides stay out",
  );
  same(decision("live_from_snapshot", { count: 3 }).text, "LiveTickets לא ענה - 3 קטגוריות תומחרו מתמונת המצב השמורה; בדקו את המחיר לפני האישור", "live_from_snapshot: the text");
}

// ---- Task 8: server-action rules (lib/uploader/run-rules.ts) ------------------------------------
{
  const R = runRules;
  const AT = "2026-10-21T10:00:00.000Z";
  const CLAPTON = "Eric Clapton";
  const showAt = (city: string, date: string, tixId: string, liveId: number | null, over: Partial<ShowIdentity> = {}): ShowIdentity => ({
    name_english: CLAPTON,
    city,
    country_code: "GB",
    venue: `${city} Arena`,
    date,
    lat: 51.5,
    lon: -0.17,
    suppliers: {
      tixstock: { event_id: tixId, name: CLAPTON, ticket_count: 40, venue_map_url: null },
      livetickets: liveId === null ? null : { event_id: liveId, name_heb: "אריק קלפטון", sellable: 3 },
    },
    competition: null,
    home_team: null,
    away_team: null,
    fallback: [],
    ...over,
  });
  const ask = (kind: UploaderQuestion["kind"], show: ShowIdentity, keys: string[], over: Partial<UploaderQuestion> = {}): UploaderQuestion => ({
    kind,
    key: questionKey(show, CLAPTON),
    text: "?",
    options: keys.map((k) => ({ key: k, label: `label ${k}` })),
    free_text: false,
    asked_at: AT,
    task_id: "task-1",
    ...over,
  });
  const answer = (key: string | null, text: string | null = null): runRules.StoredAnswer => ({ key, text, by: "user-1", at: AT });

  // Constants the actions validate with.
  same(
    [R.BRIEF_MAX, R.ANSWER_KEY_MAX, R.ANSWER_TEXT_MAX, R.REJECT_REASON_MAX, R.SKIPPED_BY_ANSWER],
    [4000, 80, 500, 500, "skipped_by_answer"],
    "task 8: input limits + the build's own skip reason",
  );
  check(R.REJECT_REASON_MAX > REJECT_REASON_MIN, "task 8: the reason window is not empty");

  // isUuid / isPositiveInt
  check(R.isUuid("0b0e8c8a-1f2d-4c3b-9a8e-7d6c5b4a3f21"), "isUuid: a uuid");
  check(R.isUuid("0B0E8C8A-1F2D-4C3B-9A8E-7D6C5B4A3F21"), "isUuid: upper case");
  check(!R.isUuid("0b0e8c8a-1f2d-4c3b-9a8e-7d6c5b4a3f21 "), "isUuid: trailing space");
  check(!R.isUuid("0b0e8c8a-1f2d-4c3b-9a8e-7d6c5b4a3f2"), "isUuid: one character short");
  check(!R.isUuid("not-a-uuid,status.eq.found"), "isUuid: anything else");
  check(!R.isUuid(5) && !R.isUuid(null) && !R.isUuid(undefined), "isUuid: non-strings");
  check(R.isPositiveInt(3) && R.isPositiveInt(1), "isPositiveInt: 1, 3");
  check(![0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "3", null].some((v) => R.isPositiveInt(v)), "isPositiveInt: 0, negative, fraction, NaN, Infinity, text, null");

  // cleanAnswerInput: the shape check before any read.
  same(R.cleanAnswerInput({ key: " both ", text: null }), { key: "both", text: null }, "answer: a key, trimmed");
  same(R.cleanAnswerInput({ key: null, text: "  London  " }), { key: null, text: "London" }, "answer: free text, trimmed");
  same(R.cleanAnswerInput({ text: "London" }), { key: null, text: "London" }, "answer: an absent key is null");
  same(R.cleanAnswerInput({ key: "skip", text: "not ours" }), { key: "skip", text: "not ours" }, "answer: key and a note");
  same(R.cleanAnswerInput({ key: "", text: "  " }), null, "answer: both blank -> refused");
  same(R.cleanAnswerInput({}), null, "answer: nothing -> refused");
  for (const bad of [null, undefined, "skip", 5, [], ["skip"]]) same(R.cleanAnswerInput(bad), null, `answer: ${JSON.stringify(bad)} is no answer`);
  same(R.cleanAnswerInput({ key: 5 }), null, "answer: a numeric key -> refused");
  same(R.cleanAnswerInput({ key: "x".repeat(81) }), null, "answer: key over 80 -> refused");
  same(R.cleanAnswerInput({ key: "x".repeat(80) })?.key?.length, 80, "answer: key of 80 -> kept");
  same(R.cleanAnswerInput({ text: "y".repeat(501) }), null, "answer: text over 500 -> refused");
  same(R.cleanAnswerInput({ key: "skip", text: "y".repeat(501) }), null, "answer: a valid key does not excuse an over-long text");

  // checkAnswer: the key must be one of the stored options; free text only where allowed.
  const london = showAt("London", "2027-05-20", "tx-1", 9001);
  const pickShow = ask("pick_show", london, ["tx-2", "tx-1", "tx-3", "both", "skip"]);
  same(R.checkAnswer(pickShow, { key: "tx-3", text: null }), { ok: true, label: "label tx-3" }, "checkAnswer: a listed option, with its label");
  same(R.checkAnswer(pickShow, { key: "tx-9", text: null }), { ok: false }, "checkAnswer: an id the question never offered");
  same(R.checkAnswer(pickShow, { key: "yes", text: null }), { ok: false }, "checkAnswer: another kind's key");
  same(R.checkAnswer(pickShow, { key: null, text: "the evening one" }), { ok: false }, "checkAnswer: free text where the question has none");
  const pickLocation = ask("pick_location", london, ["4", "skip"], { free_text: true });
  same(R.checkAnswer(pickLocation, { key: null, text: "London" }), { ok: true, label: null }, "checkAnswer: free text where allowed");
  same(R.checkAnswer(pickLocation, { key: null, text: "  " }), { ok: false }, "checkAnswer: blank free text");
  same(R.checkAnswer(pickLocation, { key: "4", text: null }), { ok: true, label: "label 4" }, "checkAnswer: a location id option");

  // answerEffect
  same(R.answerEffect(pickShow, london, answer("skip")), { kind: "skip" }, "effect: skip");
  same(R.answerEffect(pickShow, london, answer("tx-3")), { kind: "requeue", show: london }, "effect: a listing - the build re-reads it, the show is untouched here");
  same(R.answerEffect(pickLocation, london, answer(null, "London")), { kind: "requeue", show: london }, "effect: a location - the build applies it");
  const pickDate = ask("pick_date", london, ["tix:2027-05-20", "live:2027-05-21", "both", "skip"]);
  const moved = R.answerEffect(pickDate, london, answer("live:2027-05-21"));
  same(moved.kind === "requeue" ? [moved.show.date, moved.show.suppliers] : null, ["2027-05-21", london.suppliers], "effect: a day moves the show, both suppliers stay");
  same(london.date, "2027-05-20", "effect: the input show is not mutated");

  const dateBoth = R.answerEffect(pickDate, london, answer("both"));
  check(dateBoth.kind === "split" && dateBoth.extra.length === 1, "effect: pick_date both -> one extra show");
  if (dateBoth.kind === "split") {
    same([dateBoth.show.date, dateBoth.show.suppliers.livetickets, dateBoth.show.suppliers.tixstock?.event_id], ["2027-05-20", null, "tx-1"], "effect: pick_date both - the item is TixStock's show on its day");
    const extra = dateBoth.extra[0];
    same([extra.show.date, extra.show.suppliers.tixstock, extra.show.suppliers.livetickets?.event_id], ["2027-05-21", null, 9001], "effect: pick_date both - the extra is LiveTickets' show on its day");
    same([extra.question.key, extra.question.task_id, extra.question.answer?.key, extra.question.answer?.by], [`${pickDate.key}#both:2`, null, "live:2027-05-21", "user-1"], "effect: the extra's question is answered, keyed apart, no task");
  }

  const showBoth = R.answerEffect(pickShow, london, answer("both"));
  check(showBoth.kind === "split", "effect: pick_show both -> split");
  if (showBoth.kind === "split") {
    same(showBoth.show, london, "effect: pick_show both - the item keeps the listing (and partner) it holds");
    same(showBoth.extra.map((e) => e.question.answer?.key), ["tx-2", "tx-3"], "effect: one extra per OTHER listing, in option order (the held tx-1 is skipped)");
    same(showBoth.extra.map((e) => e.question.key), [`${pickShow.key}#both:2`, `${pickShow.key}#both:3`], "effect: extras keyed apart from the original question");
    same(showBoth.extra.map((e) => e.show.suppliers.livetickets), [null, null], "effect: the LiveTickets partner stays on ONE item only");
    check(showBoth.extra.every((e) => e.question.task_id === null && e.question.answer?.at === AT), "effect: extras carry no task and the answer's time");
  }
  const pickLive = ask("pick_show", london, ["live:9001", "live:9002", "both", "skip"]);
  const liveBoth = R.answerEffect(pickLive, london, answer("both"));
  same(
    liveBoth.kind === "split" ? liveBoth.extra.map((e) => [e.question.answer?.key, e.show.suppliers.tixstock, e.show.suppliers.livetickets?.event_id]) : null,
    [["live:9002", null, 9001]],
    "effect: LiveTickets listings - the extra drops the TixStock partner (the build swaps in live:9002)",
  );
  const unheld = R.answerEffect(pickShow, showAt("London", "2027-05-20", "tx-zz", null), answer("both"));
  same(unheld.kind === "split" ? unheld.extra.map((e) => e.question.answer?.key) : null, ["tx-1", "tx-3"], "effect: a show holding no option keeps the first one, the rest become extras");

  // confirm_subject: "yes" / "skip"
  const confirm = ask("confirm_subject", london, ["yes", "skip"]);
  same(R.checkAnswer(confirm, { key: "yes", text: null }), { ok: true, label: "label yes" }, "confirm_subject: yes is an option");
  same(R.checkAnswer(confirm, { key: "both", text: null }), { ok: false }, "confirm_subject: both is not");
  same(R.checkAnswer(confirm, { key: null, text: "the other one" }), { ok: false }, "confirm_subject: no free text");
  same(R.answerEffect(confirm, london, answer("yes")), { kind: "requeue", show: london }, "confirm_subject: yes -> built as found");
  same(R.answerEffect(confirm, london, answer("skip")), { kind: "skip" }, "confirm_subject: skip -> skipped");

  // pick_date "both" with a day option missing: the show's own date stands in
  const noLiveDay = ask("pick_date", london, ["tix:2027-05-20", "both", "skip"]);
  const fallbackSplit = R.answerEffect(noLiveDay, london, answer("both"));
  same(
    fallbackSplit.kind === "split" ? [fallbackSplit.show.date, fallbackSplit.extra[0]?.show.date, fallbackSplit.extra[0]?.question.answer?.key] : null,
    ["2027-05-20", "2027-05-20", "live:2027-05-20"],
    "pick_date both, no LiveTickets day option -> the extra keeps the show's date",
  );
  const noTixDay = ask("pick_date", showAt("London", "2027-05-21", "tx-1", 9001), ["live:2027-05-22", "both", "skip"]);
  const fallbackTix = R.answerEffect(noTixDay, showAt("London", "2027-05-21", "tx-1", 9001), answer("both"));
  same(
    fallbackTix.kind === "split" ? [fallbackTix.show.date, fallbackTix.extra[0]?.show.date] : null,
    ["2027-05-21", "2027-05-22"],
    "pick_date both, no TixStock day option -> the item keeps the show's date",
  );

  // planRunItems
  const A = showAt("London", "2027-05-20", "tx-a", 1);
  const E = showAt("Berlin", "2027-05-21", "tx-e1", null, { country_code: "DE" });
  const D = showAt("Milan", "2027-05-22", "tx-d", 4, { country_code: "IT" });
  const B = showAt("Paris", "2027-05-25", "tx-paris", null, { country_code: "FR" });
  const C = showAt("Zurich", "2027-05-28", "tx-c", null, { country_code: "CH" });
  const F = showAt("Madrid", "2027-05-30", "tx-f", 6, { country_code: "ES" });
  const G = showAt("Rome", "2027-05-31", "tx-g1", null, { country_code: "IT" });
  const H = showAt("Vienna", "2027-06-02", "tx-h1", null, { country_code: "AT" });
  const qE = ask("pick_show", E, ["tx-e1", "tx-e2", "both", "skip"], { task_id: null });
  const qD = ask("pick_date", D, ["tix:2027-05-22", "live:2027-05-23", "both", "skip"], { task_id: null });
  const qF = ask("pick_date", F, ["tix:2027-05-30", "live:2027-05-31", "both", "skip"], { task_id: null });
  const qG = ask("pick_show", G, ["tx-g1", "tx-g2", "both", "skip"], { task_id: null });
  const qH = ask("pick_show", H, ["tx-h1", "tx-h2", "both", "skip"], { task_id: null });
  const prior = (kind: PriorItem["kind"], key: string, ans: { key: string | null; text: string | null } | null, extra: Partial<PriorItem> = {}): PriorItem => ({
    subject_en: CLAPTON,
    kind,
    key,
    answer: ans,
    run_no: 3,
    by: "Alon",
    ...extra,
  });
  const existing: ExistingEvent[] = [{ id: 812, name_english: CLAPTON, date: "2027-05-25T20:00:00", city_iata: "PAR", eids: ["tx-paris"], is_hidden: true }];
  const drafts = R.planRunItems({
    shows: [B, A, C],
    questions: [
      { show: H, question: qH },
      { show: G, question: qG },
      { show: F, question: qF },
      { show: D, question: qD },
      { show: E, question: qE },
    ],
    existing,
    priors: [
      prior("rejected", questionKey(C, CLAPTON), null, { run_no: 2, by: "", reason: "never in Zurich" }),
      prior("pick_show", qE.key, { key: "tx-e2", text: null }),
      prior("pick_date", qF.key, { key: "both", text: null }),
      prior("pick_show", qG.key, { key: "tx-gone", text: null }),
      prior("pick_show", qH.key, { key: "skip", text: null }),
    ],
    fallback: new Map([[showKey(A.country_code, A.city, A.date, A.home_team), ["xs2event" as const]]]),
    subject_en: CLAPTON,
    at: AT,
  });
  same(
    drafts.map((d) => [d.position, d.show.city, d.status]),
    [
      [0, "London", "found"],
      [1, "Berlin", "found"],
      [2, "Milan", "question"],
      [3, "Paris", "skipped"],
      [4, "Zurich", "skipped"],
      [5, "Madrid", "found"],
      [6, "Madrid", "found"],
      [7, "Rome", "question"],
      [8, "Vienna", "skipped"],
    ],
    "planRunItems: soonest first, shows and questions merged, a split's extra right after it",
  );
  same([drafts[0].show.fallback, drafts[0].decisions, drafts[0].question, drafts[0].ask], [["xs2event"], [], null, false], "planRunItems: a plain show is found, with its XS2Event sighting");
  same([drafts[1].question?.answer?.key, drafts[1].question?.answer?.by, drafts[1].question?.answer?.at, drafts[1].ask], ["tx-e2", "Alon", AT, false], "planRunItems: an earlier answer is applied, no task");
  same(drafts[1].decisions.map((d) => d.code), ["prior_answer"], "planRunItems: ... with the prior_answer decision");
  check(drafts[1].decisions[0].text.includes("Alon") && drafts[1].decisions[0].text.includes("#3"), `planRunItems: the decision names who and which run (${drafts[1].decisions[0].text})`);
  same([drafts[2].ask, drafts[2].question?.answer, drafts[2].question?.key], [true, undefined, qD.key], "planRunItems: an unanswered question waits for a person (ask)");
  same([drafts[3].skip_reason, drafts[3].decisions.map((d) => d.code), drafts[3].question, drafts[3].ask], ["exists", ["duplicate_dropped"], null, false], "planRunItems: already on the site -> skipped exists");
  check(drafts[3].decisions[0].text.includes("812"), "planRunItems: the duplicate names the existing event");
  same([drafts[4].skip_reason, drafts[4].decisions.map((d) => d.code)], ["rejected_before", ["rejected_before"]], "planRunItems: rejected for good -> skipped rejected_before");
  check(drafts[4].decisions[0].text.includes("never in Zurich") && drafts[4].decisions[0].text.includes("#2"), "planRunItems: ... quoting the reason and the run");
  same(
    [drafts[5].show.date, drafts[5].show.suppliers.livetickets, drafts[5].question?.answer?.key],
    ["2027-05-30", null, "both"],
    "planRunItems: an earlier 'both' splits - the item is TixStock's day",
  );
  same(
    [drafts[6].show.date, drafts[6].show.suppliers.tixstock, drafts[6].question?.key, drafts[6].decisions.map((d) => d.code), drafts[6].ask],
    ["2027-05-31", null, `${qF.key}#both:2`, ["prior_answer"], false],
    "planRunItems: ... and LiveTickets' day is its own found item",
  );
  same([drafts[7].ask, drafts[7].decisions], [true, []], "planRunItems: an earlier answer this question no longer offers is not applied - asked again");
  same([drafts[8].skip_reason, drafts[8].question?.answer?.key, drafts[8].ask], ["skipped_by_answer", "skip", false], "planRunItems: an earlier 'skip' skips the show again");
  same(R.planRunItems({ shows: [], questions: [], existing, priors: [], fallback: new Map(), subject_en: CLAPTON, at: AT }), [], "planRunItems: nothing found -> no items");
  same(B.fallback, [], "planRunItems: input shows are not mutated");

  // planEdits: what staff changed, measured from the card they saw (the model's plan + prior markups)
  const aiPlan = (): UploaderPlan => ({ ...emptyPlan(), subject: { kind: "artist", name_he: null, name_en: CLAPTON } });
  const confirmed = (additional: number | null, ticketOnly: number | null, nameEn = CLAPTON): UploaderPlan => ({
    ...aiPlan(),
    subject: { kind: "artist", name_he: null, name_en: nameEn },
    markups: { ticket_only: ticketOnly, additional },
  });
  const lastRun = { ticket_only: 200, additional: 75 };
  same(R.planEdits(aiPlan(), confirmed(75, 200), lastRun), [], "planEdits: markups the server filled from the last run and nobody touched are no edit");
  same(
    R.planEdits(aiPlan(), confirmed(90, 200), lastRun),
    [{ field: "markups.additional", from: 75, to: 90 }],
    "planEdits: a prior-filled markup staff changed is an edit FROM the value they saw",
  );
  same(
    R.planEdits(aiPlan(), confirmed(75, 200, "Eric Clapton Band"), lastRun),
    [{ field: "subject.name_en", from: CLAPTON, to: "Eric Clapton Band" }],
    "planEdits: other fields still diff as before",
  );
  same(R.planEdits(aiPlan(), confirmed(75, 200), null), [
    { field: "markups.ticket_only", from: null, to: 200 },
    { field: "markups.additional", from: null, to: 75 },
  ], "planEdits: no earlier run -> a markup staff typed is an edit");
  same(R.planEdits(null, confirmed(75, 200), lastRun), [], "planEdits: no model plan (manual form) -> no lessons");
  same(
    R.planEdits({ ...aiPlan(), markups: { ticket_only: 150, additional: null } }, confirmed(75, 180), "unknown"),
    [{ field: "markups.ticket_only", from: 150, to: 180 }],
    "planEdits: prior unreadable -> a markup the model left empty teaches nothing; one it set still does",
  );

  // runCounts / nextRunStatus
  same(
    R.runCounts(["found", "found", "ready", "made-up"]),
    { found: 2, building: 0, question: 0, skipped: 0, ready: 1, approved: 0, rejected: 0, error: 0, total: 4 },
    "runCounts: every status (zeros too) + total; an unknown status counts in total only",
  );
  same(R.nextRunStatus("building", R.runCounts(["found", "ready"])), "building", "run status: something to build -> building");
  same(R.nextRunStatus("building", R.runCounts(["building", "question"])), "building", "run status: a build in flight -> building");
  same(R.nextRunStatus("building", R.runCounts(["question", "ready"])), "waiting", "run status: only questions left to unblock -> waiting");
  same(R.nextRunStatus("waiting", R.runCounts(["ready", "approved", "skipped"])), "review", "run status: built events to approve -> review");
  same(R.nextRunStatus("review", R.runCounts(["approved", "rejected", "skipped"])), "done", "run status: nothing left for anyone -> done");
  same(R.nextRunStatus("review", R.runCounts(["approved", "rejected", "skipped", "error"])), "review", "run status: an error item keeps the run in review (retry or reject it) - never done");
  same(R.nextRunStatus("building", R.runCounts(["error"])), "review", "run status: only an error left -> review");
  same(R.nextRunStatus("building", R.runCounts(["error", "question"])), "waiting", "run status: a question still outranks an error");
  same(R.nextRunStatus("done", R.runCounts(["found", "approved"])), "building", "run status: a re-queued item reopens a done run");
  same(R.nextRunStatus("planned", R.runCounts([])), "done", "run status: a run with no items is done");
  same(R.nextRunStatus("stopped", R.runCounts(["found"])), "stopped", "run status: stopped stays stopped");
  same(R.nextRunStatus("error", R.runCounts(["found"])), "error", "run status: error stays error");
  same([...R.RECOMPUTED_RUN_STATUSES].sort(), ["building", "done", "planned", "review", "waiting"], "run status: the recompute never overwrites stopped / error");

  // planPreview
  same(
    R.planPreview({ shows: [B, A, showAt("London", "2027-06-10", "tx-l2", null)], questions: [{ show: D }], existing }),
    { shows: 3, questions: 1, existing: 1, cities: ["London", "Milan", "Paris"] },
    "planPreview: counts, the existing ones among the shows, each city once, soonest first",
  );
  same(R.planPreview({ shows: [], questions: [], existing: [] }), R.EMPTY_PREVIEW, "planPreview: nothing found");

  // EDIT_EVENT_COLUMNS covers the edit diff.
  same(
    R.EDIT_EVENT_COLUMNS.split(",").sort(),
    ["id", "tickets_and_rates", ...EDIT_WHITELIST.filter((f) => f !== "tickets_count")].sort(),
    "EDIT_EVENT_COLUMNS: every whitelisted field (tickets_count read off tickets_and_rates), plus the id",
  );

  // subjectArtOf (over the row the one candidate read picked)
  const artistRow = (art: string | null, image: string | null, nameEn: string | null = "Eric Clapton", name: string | null = "אריק קלפטון"): runRules.SubjectArtRow => ({
    name,
    name_english: nameEn,
    image_url: image,
    art_image_url: art,
  });
  same(R.subjectArtOf("artist", artistRow("cut.png", "flat.jpg"), CLAPTON), { kind: "artist", name_english: CLAPTON, image_url: "cut.png" }, "subjectArt: the cut-out first");
  same(R.subjectArtOf("artist", artistRow("  ", "flat.jpg"), CLAPTON)?.image_url, "flat.jpg", "subjectArt: a blank cut-out -> the photo");
  same(R.subjectArtOf("artist", artistRow(null, null), CLAPTON)?.image_url, null, "subjectArt: no picture at all -> null image");
  same(R.subjectArtOf("artist", artistRow("cut.png", null, null), CLAPTON)?.name_english, CLAPTON, "subjectArt: a row with no English name -> the run's");
  same(R.subjectArtOf("artist", null, CLAPTON), null, "subjectArt: no artist row -> null");
  const teamRow: runRules.SubjectArtRow = { name: "ליברפול", name_english: "Liverpool", logo_url: "crest.svg", image_url: "team.jpg", art_image_url: null };
  same(R.subjectArtOf("team", teamRow, "Liverpool FC"), { kind: "team", name_english: "Liverpool", image_url: "crest.svg" }, "subjectArt: a team's crest, under its own English name");
  same(R.subjectArtOf("team", { ...teamRow, logo_url: null }, "Liverpool FC")?.image_url, "team.jpg", "subjectArt: no crest -> the team photo");
  same(R.subjectArtOf("competition", teamRow, "Premier League"), null, "subjectArt: a competition has no picture");

  // artSearchPattern: the ONE candidate read's ilike pattern
  same(R.artSearchPattern("team", "Liverpool FC"), "%liverpool%", "art pattern: a team's first club token (FC dropped)");
  same(R.artSearchPattern("team", "FC Barcelona"), "%barcelona%", "art pattern: a leading qualifier is not the token");
  same(R.artSearchPattern("artist", "  Eric Clapton "), "%Eric%", "art pattern: an artist's first word");
  same(R.artSearchPattern("artist", "100%_Pure\\Band"), "%100\\%\\_Pure\\\\Band%", "art pattern: %, _ and the escape char are escaped");
  same(R.artSearchPattern("artist", "Sta*r Band"), null, "art pattern: a '*' (PostgREST's wildcard) -> no read");
  same([R.artSearchPattern("artist", "   "), R.artSearchPattern("team", "FC"), R.artSearchPattern("competition", "Premier League")], [null, null, null], "art pattern: blank / no club token / a competition -> no read");

  // pickArtRow: the candidate that IS the subject
  const liverpoolRows: runRules.SubjectArtRow[] = [
    { name: "ליברפול 2", name_english: "Liverpool Reserves", logo_url: "r.svg", image_url: null, art_image_url: null },
    teamRow,
  ];
  same(R.pickArtRow("team", liverpoolRows, { name_en: "Liverpool FC", name_he: null })?.name_english, "Liverpool", "pickArtRow: a team by clubKey equality ('Liverpool FC' = 'Liverpool'), not by containment");
  same(R.pickArtRow("team", liverpoolRows, { name_en: "Everton", name_he: null }), null, "pickArtRow: no club match -> null");
  const ericRows = [artistRow("a.png", null, "Eric Church", "אריק צ'רץ'"), artistRow("b.png", null, "ERIC CLAPTON", "אריק קלפטון")];
  same(R.pickArtRow("artist", ericRows, { name_en: "Eric Clapton", name_he: null })?.art_image_url, "b.png", "pickArtRow: an artist by normalized English name");
  same(
    R.pickArtRow("artist", [artistRow("c.png", null, "Clapton, Eric", "אריק קלפטון")], { name_en: "Eric Clapton", name_he: "אריק קלפטון" })?.art_image_url,
    "c.png",
    "pickArtRow: ... else by the Hebrew name",
  );
  same(R.pickArtRow("artist", ericRows, { name_en: "Eric Idle", name_he: null }), null, "pickArtRow: no artist match -> null");
  same(R.pickArtRow("competition", liverpoolRows, { name_en: "Liverpool", name_he: null }), null, "pickArtRow: a competition -> null");

  // liveBlockers: approve-time blockers, judged by the event row's CURRENT package_mode
  const FIX = "/events/812#fix-price";
  const flightBlock = { code: "no_base_price", text: WARNING_TEXT.no_base_price, fix_url: FIX };
  const hotelBlock = { code: "no_base_price", text: WARNING_TEXT.no_base_price_hotel, fix_url: FIX };
  const markupBlock = { code: "no_ticket_only_markup", text: WARNING_TEXT.no_ticket_only_markup, fix_url: FIX };
  const otherBlock = { code: "something_else", text: "?" };
  const pkg = (flight: number | null, hotel: number | null) => ({ id: 812, package_mode: "package", base_flight_price: flight, base_hotel_price: hotel, ticket_only_markup: null });
  const tkt = (markup: number | null) => ({ id: 812, package_mode: "ticket_only", base_flight_price: 0, base_hotel_price: 0, ticket_only_markup: markup });
  same(R.liveBlockers([flightBlock, hotelBlock], pkg(310, 290)), [], "liveBlockers: both bases filled in the editor -> both no_base_price clear");
  same(R.liveBlockers([flightBlock, hotelBlock], pkg(310, 0)), [hotelBlock], "liveBlockers: only the base still 0 keeps its blocker");
  same(R.liveBlockers([flightBlock], pkg(310, 0)), [hotelBlock], "liveBlockers: a base that is still 0 adds its blocker when the stored list lacks it (same link)");
  same(R.liveBlockers([flightBlock], { ...pkg(310, 290), package_mode: null }), [], "liveBlockers: an unset package_mode is a package");
  same(R.liveBlockers([flightBlock], pkg(null, 290)), [flightBlock], "liveBlockers: a null base is not filled");
  same(R.liveBlockers([markupBlock], tkt(0)), [], "liveBlockers: a ticket-only markup of 0 is a markup -> clears");
  same(R.liveBlockers([markupBlock], tkt(120)), [], "liveBlockers: a ticket-only markup -> clears");
  same(R.liveBlockers([markupBlock], tkt(null)), [markupBlock], "liveBlockers: still no markup -> stays");
  same(R.liveBlockers([otherBlock, flightBlock], pkg(1, 1)), [otherBlock], "liveBlockers: any other code stays as stored");
  same([R.liveBlockers([], pkg(310, 290)), R.liveBlockers(null, tkt(5)), R.liveBlockers(undefined, pkg(310, 290))], [[], [], []], "liveBlockers: nothing stored and nothing missing -> nothing");
  // The mode staff switched to in the editor decides.
  same(R.liveBlockers([flightBlock, hotelBlock], tkt(150)), [], "liveBlockers: package -> ticket_only with a markup set: no blockers (no_base_price clears)");
  same(R.liveBlockers([flightBlock, hotelBlock], tkt(null)), [markupBlock], "liveBlockers: package -> ticket_only with no markup: no_ticket_only_markup added");
  same(
    R.liveBlockers([markupBlock], pkg(0, 0)),
    [
      { code: "no_base_price", text: WARNING_TEXT.no_base_price, fix_url: FIX },
      { code: "no_base_price", text: WARNING_TEXT.no_base_price_hotel, fix_url: FIX },
    ],
    "liveBlockers: ticket_only -> package with bases 0: no_ticket_only_markup clears, no_base_price (both) added",
  );
  same(R.liveBlockers([markupBlock], pkg(310, 290)), [], "liveBlockers: ticket_only -> package with bases filled: no blockers");
  same(
    R.liveBlockers([], { package_mode: "ticket_only", ticket_only_markup: null, id: 9 }),
    [{ code: "no_ticket_only_markup", text: WARNING_TEXT.no_ticket_only_markup, fix_url: "/events/9#fix-price" }],
    "liveBlockers: an added blocker with no stored link links to the event's price section",
  );

  // canRebuildTwoCity: only a show with no package
  same(R.canRebuildTwoCity({ status: "ready", mode: "ticket_only", skip_reason: null }), true, "two-city rebuild: a built ticket-only event");
  same(R.canRebuildTwoCity({ status: "ready", mode: "package", skip_reason: null }), false, "two-city rebuild: never a package");
  same(R.canRebuildTwoCity({ status: "skipped", mode: null, skip_reason: "no_location" }), true, "two-city rebuild: a show skipped for no location");
  same(
    ["exists", "no_tickets", "rejected_before", "skipped_by_answer"].map((r) => R.canRebuildTwoCity({ status: "skipped", mode: null, skip_reason: r })),
    [false, false, false, false],
    "two-city rebuild: never undoes another skip",
  );
  same(
    (["found", "question", "approved", "rejected", "error", "building"] as const).map((s) => R.canRebuildTwoCity({ status: s, mode: "ticket_only", skip_reason: "no_location" })),
    [false, false, false, false, false, false],
    "two-city rebuild: no other status",
  );

  // isStaleBuild / sameSubject / hasBuiltEvent / REJECTABLE_STATUSES
  const T0 = Date.parse("2026-10-21T10:00:00.000Z");
  same(R.STALE_BUILD_MS, 180_000, "stale build: 3 minutes");
  same(
    [R.isStaleBuild("2026-10-21T09:56:59.000Z", T0), R.isStaleBuild("2026-10-21T09:57:30.000Z", T0), R.isStaleBuild("garbage", T0), R.isStaleBuild(null, T0)],
    [true, false, false, false],
    "stale build: older than 3 min only; an unreadable time is not stale",
  );
  const subj = (kind: "artist" | "team" | "competition", name_en: string) => ({ kind, name_he: null, name_en });
  same(
    [
      R.sameSubject(subj("artist", "Eric Clapton"), subj("artist", "  eric clapton ")),
      R.sameSubject(subj("artist", "Eric Clapton"), subj("team", "Eric Clapton")),
      R.sameSubject(subj("artist", "Eric Clapton"), subj("artist", "Eric Church")),
      R.sameSubject(subj("artist", ""), subj("artist", "")),
    ],
    [true, false, false, false],
    "sameSubject: kind + normalized name; a blank name is nobody",
  );
  type BuiltProbe = Parameters<typeof R.hasBuiltEvent>[0];
  const asItem = (status: BuiltProbe["status"], event_id: number | null): BuiltProbe => ({ status, event_id }) as BuiltProbe;
  same(
    [R.hasBuiltEvent(asItem("ready", 812)), R.hasBuiltEvent(asItem("ready", null)), R.hasBuiltEvent(asItem("approved", 812))],
    [true, false, false],
    "hasBuiltEvent: a ready item with its event only",
  );
  same([...R.REJECTABLE_STATUSES].sort(), ["error", "found", "question", "ready"], "reject: from ready / question / found / error only");

  // canResume: "המשך"
  same(R.canResume("stopped", 0), true, "resume: a stopped run, even with nothing left to build");
  same(R.canResume("waiting", 2), true, "resume: a non-terminal run with items to build");
  same(["planned", "building", "review"].map((s) => R.canResume(s, 1)), [true, true, true], "resume: every non-terminal status with work left");
  same(R.canResume("waiting", 0), false, "resume: nothing to build -> nothing to resume");
  same([R.canResume("done", 3), R.canResume("error", 3)], [false, false], "resume: done / error are terminal");

  // twoCityOf / withTwoCity
  const chosen = R.withTwoCity(A, 7);
  same(R.twoCityOf(chosen), { flightCityId: 7 }, "two-city: the choice rides on the show");
  check(!("two_city" in A), "two-city: withTwoCity copies, never mutates");
  same(R.twoCityOf(A), null, "two-city: no choice");
  for (const bad of [null, "x", { two_city: null }, { two_city: { flight_city_id: "7" } }, { two_city: { flight_city_id: 0 } }, { two_city: { flight_city_id: 2.5 } }]) {
    same(R.twoCityOf(bad), null, `two-city: ${JSON.stringify(bad)} is no choice`);
  }
}

// ---- Task 15: the fix wave (final review + security review + ledger minors) ----------------------
{
  const R = runRules;
  const AT = "2026-10-21T10:00:00.000Z";
  const CLAPTON = "Eric Clapton";
  const show15 = (city: string, date: string, tixId: string | null, liveId: number | null, over: Partial<ShowIdentity> = {}): ShowIdentity => ({
    name_english: CLAPTON,
    city,
    country_code: "GB",
    venue: `${city} Arena`,
    date,
    lat: 51.5,
    lon: -0.17,
    suppliers: {
      tixstock: tixId === null ? null : { event_id: tixId, name: CLAPTON, ticket_count: 40, venue_map_url: null },
      livetickets: liveId === null ? null : { event_id: liveId, name_heb: "אריק קלפטון", sellable: 3 },
    },
    competition: null,
    home_team: null,
    away_team: null,
    fallback: [],
    ...over,
  });
  const q15 = (kind: UploaderQuestion["kind"], show: ShowIdentity, keys: string[], over: Partial<UploaderQuestion> = {}): UploaderQuestion => ({
    kind,
    key: questionKey(show, CLAPTON),
    text: "?",
    options: keys.map((k) => ({ key: k, label: `label ${k}` })),
    free_text: false,
    asked_at: AT,
    task_id: null,
    ...over,
  });

  // C1: a test run's rejections never poison a real run (and a real run's still count on a test run).
  const zurich = show15("Zurich", "2027-05-28", "tx-z", null, { country_code: "CH" });
  const london = show15("London", "2027-05-20", "tx-l", null);
  const runs: { id: string; plan: { subject: { name_en: string } }; is_test: boolean | null }[] = [
    { id: "run-real-1", plan: { subject: { name_en: CLAPTON } }, is_test: false },
    { id: "run-other", plan: { subject: { name_en: "Liverpool FC" } }, is_test: false },
    { id: "run-test-1", plan: { subject: { name_en: "eric  CLAPTON" } }, is_test: true },
    { id: "run-legacy", plan: { subject: { name_en: CLAPTON } }, is_test: null },
  ];
  const realScope = priorRunScope(runs, CLAPTON, false);
  const testScope = priorRunScope(runs, CLAPTON, true);
  same(realScope.runIds, ["run-real-1", "run-legacy"], "C1: a REAL run learns from real runs of the subject only (a null is_test is real)");
  same(testScope.runIds, ["run-real-1", "run-test-1", "run-legacy"], "C1: a TEST run reads test and real runs");
  same([realScope.runNo.get("run-test-1"), realScope.runNo.get("run-legacy")], [3, 4], "C1: every run keeps its number (test runs counted) - 'ריצה #N' names one run");
  same(priorRunScope(runs, "  ", false).runIds, [], "C1: a blank subject reads nothing");
  const itemRows = [
    { run_id: "run-test-1", show: zurich, question: null, rejected_final: true, rejected_reason: "rehearsal" },
    { run_id: "run-real-1", show: london, question: null, rejected_final: true, rejected_reason: "never in London" },
    { run_id: "run-other", show: zurich, question: null, rejected_final: true, rejected_reason: "another subject" },
  ];
  const realPriors = priorItemsOf(itemRows, realScope, new Map());
  const testPriors = priorItemsOf(itemRows, testScope, new Map());
  same(realPriors.map((p) => [p.kind, p.reason, p.run_no]), [["rejected", "never in London", 1]], "C1: the real scope drops the test run's (and another subject's) rejections");
  same(testPriors.map((p) => p.reason), ["rehearsal", "never in London"], "C1: the test scope keeps both");
  const plan15 = (priors: PriorItem[]) =>
    R.planRunItems({ shows: [london, zurich], questions: [], existing: [], priors, fallback: new Map(), subject_en: CLAPTON, at: AT }).map((d) => [
      d.show.city,
      d.status,
      d.skip_reason,
    ]);
  same(plan15(realPriors), [["London", "skipped", "rejected_before"], ["Zurich", "found", null]], "C1: a REAL run builds the show only a test run rejected");
  same(plan15(testPriors), [["London", "skipped", "rejected_before"], ["Zurich", "skipped", "rejected_before"]], "C1: a TEST run still skips it");
  const answeredRow = {
    run_id: "run-test-1",
    show: london,
    question: { ...q15("pick_show", london, ["tx-l", "live:7", "both", "skip"]), answer: { key: "live:7", text: null, by: "user-x", at: AT } },
    rejected_final: false,
    rejected_reason: null,
  };
  same(priorItemsOf([answeredRow], realScope, new Map()), [], "C1: a test run's ANSWER is not applied on a real run either");
  same(
    priorItemsOf([answeredRow], testScope, new Map([["user-x", "Alon"]])).map((p) => [p.kind, p.answer?.key, p.by, p.run_no]),
    [["pick_show", "live:7", "Alon", 3]],
    "C1: ... and is on a test run, with the answerer's name",
  );

  // C2: a "both" split builds both - the name + day + IATA re-check skips an item carrying the split.
  const evening = show15("London", "2027-05-20", "tx-eve", null);
  const askBoth = q15("pick_show", evening, ["tx-mat", "tx-eve", "both", "skip"]);
  const answeredBoth: UploaderQuestion = { ...askBoth, answer: { key: "both", text: null, by: "u", at: AT } };
  const copy: UploaderQuestion = { ...askBoth, key: `${askBoth.key}#both:2`, answer: { key: "tx-eve", text: null, by: "u", at: AT } };
  check(carriesSplitAnswer(answeredBoth) && carriesSplitAnswer(copy), "C2: the answered item and the split's copy both carry the split");
  check(
    !carriesSplitAnswer(null) && !carriesSplitAnswer(askBoth) && !carriesSplitAnswer({ ...askBoth, answer: { key: "tx-eve", text: null, by: "u", at: AT } }),
    "C2: no question / unanswered / a plain pick does not",
  );
  const sibling: ExistingEvent = { id: 1301, name_english: CLAPTON, date: "2027-05-20T15:00:00", city_iata: "LON", eids: ["tx-mat"], is_hidden: true };
  same(buildDuplicateFor(evening, CLAPTON, [sibling], "LON", copy), null, "C2: the sibling's hidden event (same name, day, IATA) is not this split show");
  same(buildDuplicateFor(evening, CLAPTON, [sibling], "LON", answeredBoth), null, "C2: ... nor the answered item's");
  same(buildDuplicateFor(evening, CLAPTON, [sibling], "LON", null)?.id, 1301, "C2: without a split the name + day + IATA check still finds it");
  same(buildDuplicateFor({ ...evening, name_english: "Eric Clapton London" }, "Eric Clapton x", [sibling], "LON", null), null, "C2: neither spelling matching = no duplicate");
  same(buildDuplicateFor({ ...evening, name_english: CLAPTON }, "Eric Clapton London", [sibling], "LON", null)?.id, 1301, "C2: ... the supplier's own title still finds it");

  // C3: the resolved subject is cached on the run for SUBJECT_CACHE_MS.
  const now = Date.parse("2026-10-21T12:00:00.000Z");
  const cache = {
    at: "2026-10-21T11:30:00.000Z",
    subject: { kind: "competition", name_en: "Premier League", name_he: null, aliases: ["Premier League", 5] },
    rows: { artist: null, team: null },
    teamsHe: { liverpool: "ליברפול", bad: 7 },
    competitionName: "Premier League",
  };
  same(R.SUBJECT_CACHE_MS, 3_600_000, "C3: the cache stands one hour");
  same(
    R.freshSubjectCache(cache, now),
    {
      at: cache.at,
      subject: { kind: "competition", name_en: "Premier League", name_he: null, aliases: ["Premier League"] },
      rows: { artist: null, team: null },
      teamsHe: { liverpool: "ליברפול" },
      competitionName: "Premier League",
    },
    "C3: a fresh cache comes back whole (non-text aliases / names dropped)",
  );
  same(R.freshSubjectCache({ ...cache, at: "2026-10-21T10:59:59.000Z" }, now), null, "C3: older than an hour -> resolve again");
  same(R.freshSubjectCache({ ...cache, at: "2026-10-21T12:05:00.000Z" }, now), null, "C3: a time in the future -> resolve again");
  for (const bad of [null, undefined, "x", [], { ...cache, at: 5 }, { ...cache, subject: { ...cache.subject, kind: "band" } }, { ...cache, rows: { artist: null } }, { ...cache, teamsHe: [] }]) {
    same(R.freshSubjectCache(bad, now), null, `C3: a malformed cache is no cache (${String(JSON.stringify(bad)).slice(0, 40)})`);
  }

  // @@MORE@@
}

console.log(`tour uploader selftest: all ${checks} checks passed`);
