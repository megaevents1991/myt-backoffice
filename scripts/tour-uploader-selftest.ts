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
  PRICED_PARTY,
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
import type { UploaderPlan } from "@/types/uploader.types";

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
same(PRICED_PARTY, 2, "the priced party is the TixStock sync's own constant, re-exported");

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

  const none = applyPriorDefaults(bothNull, null);
  same(none.plan, bothNull, "no prior = the plan unchanged");
  same(none.fromPrior, [], "no prior = nothing reported");
  const copy = applyPriorDefaults(bothNull, { ticket_only: 1, additional: 2 });
  copy.plan.notes.push("x");
  same(bothNull.notes, ["no hotel in Zurich"], "the returned plan does not share arrays with the input");
}

console.log(`tour uploader selftest: all ${checks} checks passed`);
