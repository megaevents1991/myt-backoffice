/**
 * Company scoping of `public.flights` - the safety net of the multi-company split.
 *
 *   npx tsx --env-file=.env.development.local scripts/flights-company-scope-selftest.ts [--static-only]
 *
 * `flights` is shared by Mega Events (offline flights sold with events) and by
 * tours companies (Mega Family group blocks). The service-role client bypasses
 * RLS, so the only thing that keeps a Mega Family block out of a Mega Events
 * screen, picker, export, sync or reservation flow is the company filter in
 * code. This script fails (exit 1) when that filter is missing anywhere.
 *
 * Part 1 - static. Scans lib/, app/, components/, hooks/ and contexts/ for
 * every way of reaching the table and fails on any that is not scoped:
 *   A. a direct `.from("flights")` is allowed only inside lib/flights-scope.ts,
 *      or when the SAME statement carries `.eq("company_id", ...)` (reads,
 *      updates, deletes) or a `company_id` in its payload (inserts);
 *   B. the table name handed to a generic table helper: "flights" as the first
 *      argument of a call (fetchBefore("flights", ...), tbl("flights")), or
 *      anywhere in a file that has a dynamic `.from(<variable>)` - allow-listed
 *      calls only;
 *   C. a PostgREST embed of the relation (`select("..., flights(...)")`) needs
 *      `.eq("flights.company_id", ...)` in the same statement;
 *   D. the event-allocation relations keyed by a flight id may be used only by
 *      files that resolve the flight through megaEventsFlights();
 *   E. `flightsOf(...)` takes the server-resolved company, nothing else;
 *   F. no rpc touches flights.
 *
 * Part 2 - data, against the LOCAL database only (refuses any other URL).
 * Calls the functions that need no request context and, for the ones that need
 * a session cookie, runs the same query with the same filters. Asserts that a
 * Mega Events scope never returns or changes a row of another company, and the
 * other way round.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { supabase } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";
import { MEGA_EVENTS_COMPANY_ID } from "@/lib/company";
import { flightsOf, megaEventsFlights, sellsEvents, sellsTours } from "@/lib/flights-scope";
import { loadFlightsForExport } from "@/lib/exports/flight-export-query";
import { assertFlightValues, pickFlightColumns } from "@/lib/actions/offline-flight-columns";
import { blockStatusOptions, flightFieldSet, TOURS_FIELD_GROUP } from "@/components/flight-field-groups";
import { flightRouteLabel } from "@/lib/tours/routes";
import { BLOCK_STATUSES, BLOCK_STATUS_LABELS } from "@/types/tours.types";

const STATIC_ONLY = process.argv.includes("--static-only");
const ROOT = process.cwd();

let failed = 0;
function ok(name: string) {
  console.log(`ok   ${name}`);
}
function fail(name: string, detail: string) {
  failed++;
  console.error(`FAIL ${name}: ${detail}`);
}
function check(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) ok(name);
  else fail(name, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}
function truthy(name: string, value: unknown, detail = "expected a truthy value") {
  if (value) ok(name);
  else fail(name, detail);
}

// ============================================================ part 1: static
const SCAN_DIRS = ["lib", "app", "components", "hooks", "contexts"];
const SCOPE_FILE = "lib/flights-scope.ts";

/**
 * Calls that may take "flights" as their first argument, as "file#callee" ->
 * reason. The file is still checked for a dynamic `.from(<variable>)`: the
 * moment one appears the entry stops being safe and the scan fails.
 */
const CALL_ALLOW: Record<string, string> = {
  "lib/services/base-price-sync.ts#offlineLinkedEventIds":
    'picks a branch - "flights" goes to megaEventsFlights(), the other one names offline_hotels literally',
};

/** Direct accesses excused from rule A, as "file:line" -> reason. Empty on purpose. */
const DIRECT_ALLOW: Record<string, string> = {};

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");
const lineOf = (source: string, index: number) => source.slice(0, index).split("\n").length;

/** A line that is nothing but a comment. Trailing comments stay "code" on purpose (fail closed). */
function isCommentLine(source: string, index: number): boolean {
  const start = source.lastIndexOf("\n", index - 1) + 1;
  const end = source.indexOf("\n", index);
  const line = source.slice(start, end === -1 ? source.length : end).trim();
  return line.startsWith("//") || line.startsWith("*") || line.startsWith("/*") || line.startsWith("{/*");
}

/**
 * The rest of the statement that starts at `index` (a position inside code):
 * up to the `;`, `,`, `:` or closing bracket that ends the expression. Strings
 * and comments are skipped, so a filter mentioned in a comment does not count.
 */
function statementFrom(source: string, index: number): string {
  let depth = 0;
  let out = "";
  for (let i = index; i < source.length && i < index + 6000; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      const eol = source.indexOf("\n", i);
      i = eol === -1 ? source.length : eol - 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      const close = source.indexOf("*/", i + 2);
      i = close === -1 ? source.length : close + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) j += source[j] === "\\" ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth < 0) break;
    } else if (depth === 0 && (ch === ";" || ch === "," || ch === ":")) break;
    else if (depth === 0 && ch === "?" && next !== ".") break;
    out += ch;
  }
  return out;
}

const COMPANY_EQ = /\.eq\(\s*["'`]company_id["'`]\s*,/;
const DIRECT = /\.from\(\s*(["'`])flights\1\s*\)/g;
const LITERAL = /(["'`])flights\1/g;
const CALL_WITH_TABLE = /\b([A-Za-z_$][\w$]*)\(\s*(["'`])flights\2\s*[,)]/g;
const EMBED = /["'`,\s](?:\w+\s*:\s*)?flights\s*(?:!\w+\s*)?\(/g;
const DYNAMIC_FROM = /(?<!Array|Buffer|Object|String|Uint8Array|storage)\.from\(\s*[A-Za-z_$][\w$.]*\s*\)/g;
const FLIGHT_KEYED = /\.from\(\s*["'`](flight_event_allocations|flight_event_consumed)["'`]\s*\)/g;
const FLIGHTS_OF = /\bflightsOf\(\s*([^)]*)\)/g;
const RPC = /\.rpc\(\s*["'`]([^"'`]*flight[^"'`]*)["'`]/gi;

type Site = { where: string; how: string };
const sites: Site[] = [];

function staticScan() {
  const files = SCAN_DIRS.flatMap((dir) => walk(path.join(ROOT, dir)));
  truthy("static: source files found", files.length > 500, `only ${files.length} files under ${SCAN_DIRS.join(", ")}`);

  let unscoped = 0;
  for (const file of files) {
    const name = rel(file);
    const source = readFileSync(file, "utf8");
    if (name === SCOPE_FILE) continue;

    // ---- A. direct access
    const directAt = new Set<number>();
    for (const match of source.matchAll(DIRECT)) {
      const index = match.index ?? 0;
      if (isCommentLine(source, index)) continue;
      // the literal itself sits a few characters after ".from("
      directAt.add(source.indexOf("flights", index));
      const where = `${name}:${lineOf(source, index)}`;
      const statement = statementFrom(source, index);
      const writesRows = /\.(insert|upsert)\(/.test(statement);
      const scoped = writesRows ? /\bcompany_id\b/.test(statement) : COMPANY_EQ.test(statement);
      if (scoped) {
        sites.push({ where, how: writesRows ? "direct insert with company_id" : 'direct, .eq("company_id")' });
      } else if (DIRECT_ALLOW[where]) {
        sites.push({ where, how: `ALLOW-LISTED: ${DIRECT_ALLOW[where]}` });
      } else {
        unscoped++;
        fail(`static: ${where}`, `.from("flights") with no company filter in the same statement`);
      }
    }

    // ---- B. the table name handed to a generic table helper
    const dynamic = [...source.matchAll(DYNAMIC_FROM)].filter((m) => !isCommentLine(source, m.index ?? 0));
    if (dynamic.length > 0) {
      for (const match of source.matchAll(LITERAL)) {
        const index = match.index ?? 0;
        if (isCommentLine(source, index) || directAt.has(index + 1)) continue;
        unscoped++;
        fail(
          `static: ${name}:${lineOf(source, index)}`,
          `the string "flights" in a file with a dynamic .from(<variable>) (line ${lineOf(source, dynamic[0].index ?? 0)}) - the company scope cannot be checked`,
        );
      }
    }
    for (const match of source.matchAll(CALL_WITH_TABLE)) {
      const index = match.index ?? 0;
      if (isCommentLine(source, index)) continue;
      const callee = match[1];
      if (callee === "from") continue; // rule A
      const where = `${name}:${lineOf(source, index)}`;
      const reason = CALL_ALLOW[`${name}#${callee}`];
      if (reason && dynamic.length === 0) {
        sites.push({ where, how: `${callee}("flights") ALLOW-LISTED: ${reason}` });
      } else {
        unscoped++;
        fail(`static: ${where}`, `${callee}("flights", ...) hands the table name to a helper - the company scope is bypassed`);
      }
    }

    // ---- C. embeds of the relation from another table
    for (const match of source.matchAll(EMBED)) {
      const index = match.index ?? 0;
      if (isCommentLine(source, index)) continue;
      const lineStart = source.lastIndexOf("\n", index) + 1;
      const statement = statementFrom(source, lineStart);
      const where = `${name}:${lineOf(source, index)}`;
      if (/\.eq\(\s*["'`]flights\.company_id["'`]\s*,/.test(statement)) {
        sites.push({ where, how: 'embed, .eq("flights.company_id")' });
      } else {
        unscoped++;
        fail(`static: ${where}`, 'embeds the flights relation with no .eq("flights.company_id", ...)');
      }
    }

    // ---- D. relations keyed by a flight id
    for (const match of source.matchAll(FLIGHT_KEYED)) {
      const index = match.index ?? 0;
      if (isCommentLine(source, index)) continue;
      const where = `${name}:${lineOf(source, index)}`;
      if (/\bmegaEventsFlights\(\)/.test(source)) {
        sites.push({ where, how: `${match[1]} (flight resolved through megaEventsFlights)` });
      } else {
        unscoped++;
        fail(`static: ${where}`, `${match[1]} is keyed by a flight id - resolve the flight through megaEventsFlights() in this file`);
      }
    }

    // ---- E. the helper takes the server-resolved company
    for (const match of source.matchAll(FLIGHTS_OF)) {
      const index = match.index ?? 0;
      if (isCommentLine(source, index)) continue;
      const where = `${name}:${lineOf(source, index)}`;
      const arg = match[1].trim();
      const resolved = /\b(requireCompany|getActiveCompany)\(/.test(source) || /\bcompany\s*:\s*FlightScope\b/.test(source);
      if (arg === "company" && resolved) {
        sites.push({ where, how: "flightsOf(company) - active company" });
      } else {
        unscoped++;
        fail(`static: ${where}`, `flightsOf(${arg}) - pass the company from requireCompany()/getActiveCompany(), named "company"`);
      }
    }
    for (const match of source.matchAll(/\bmegaEventsFlights\(\)/g)) {
      const index = match.index ?? 0;
      if (isCommentLine(source, index)) continue;
      sites.push({ where: `${name}:${lineOf(source, index)}`, how: "megaEventsFlights() - constant scope" });
    }

    // ---- F. rpc
    for (const match of source.matchAll(RPC)) {
      const index = match.index ?? 0;
      if (isCommentLine(source, index)) continue;
      unscoped++;
      fail(`static: ${name}:${lineOf(source, index)}`, `rpc "${match[1]}" touches flights - an rpc cannot be checked for a company filter here`);
    }
  }

  // The scope file is the one place the raw table is named: exactly once.
  const scope = readFileSync(path.join(ROOT, SCOPE_FILE), "utf8");
  const raw = [...scope.matchAll(DIRECT)].filter((m) => !isCommentLine(scope, m.index ?? 0));
  check("static: lib/flights-scope.ts names the table exactly once", raw.length, 1);
  truthy(
    "static: lib/flights-scope.ts filters every select and update by company_id",
    (scope.match(/\.eq\("company_id", companyId\)/g) ?? []).length === 2 && /company_id: companyId/.test(scope),
    "expected .eq(\"company_id\", companyId) on select and update, and the stamp on insert",
  );
  truthy("static: no flightsTable() helper left", !files.some((f) => /\bflightsTable\b/.test(readFileSync(f, "utf8"))), "a file still defines or calls flightsTable()");

  const scopedSites = sites.filter((s) => !s.how.includes("ALLOW-LISTED"));
  truthy("static: flights call sites found", scopedSites.length >= 40, `only ${scopedSites.length} - the scanner lost its targets`);
  if (unscoped === 0) ok(`static: ${scopedSites.length} flights call sites, all scoped (${sites.length - scopedSites.length} allow-listed)`);

  console.log("\n  flights call sites");
  for (const site of sites) console.log(`    ${site.where.padEnd(58)} ${site.how}`);
  console.log("");
}

// ============================================================ pure rules
function pureChecks() {
  // What a Mega Events write may carry.
  const sneaky = {
    price: 100,
    company_id: "b4e2d3c5-6c7f-4a81-9ba2-c3d4e5f6a702",
    contract_id: "x",
    reviewed_at: "2026-01-01",
    import_ref: "x",
    season_label: "קיץ",
    cost_tax: 55,
    id: 1,
    consumed_quantity: 9,
    is_deleted: true,
  };
  check("columns: Mega Events write keeps only its own columns", pickFlightColumns(sneaky), { price: 100 });
  check("columns: tours write adds the operations columns, never company_id", pickFlightColumns(sneaky, { tours: true }), {
    price: 100,
    season_label: "קיץ",
    cost_tax: 55,
  });

  const throws = (fn: () => void) => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };
  check("status: Mega Events keeps option/confirmed/ticketed", ["option", "confirmed", "ticketed"].map((s) => throws(() => assertFlightValues({ block_status: s }))), [false, false, false]);
  check(
    "status: Mega Events refuses the tours lifecycle",
    ["approved", "requested", "declined", "operational", "cancelled"].map((s) => throws(() => assertFlightValues({ block_status: s }))),
    [true, true, true, true, true],
  );
  check("status: a tours company takes the whole lifecycle", BLOCK_STATUSES.map((s) => throws(() => assertFlightValues({ block_status: s }, { tours: true }))), BLOCK_STATUSES.map(() => false));
  check("status: null clears it in both", [throws(() => assertFlightValues({ block_status: null })), throws(() => assertFlightValues({ block_status: null }, { tours: true }))], [false, false]);

  const events = flightFieldSet(false);
  const tours = flightFieldSet(true);
  check("fields: Mega Events status options", events.byKey.get("block_status")?.options, ["option", "confirmed", "ticketed"]);
  check("fields: Mega Events has no tours group", [events.groups.includes(TOURS_FIELD_GROUP), events.fields.some((f) => f.group === TOURS_FIELD_GROUP)], [false, false]);
  check("fields: Mega Events default columns unchanged", events.defaultVisible, [
    "airline_code",
    "outbound_flight_number",
    "outbound_departure_airport",
    "outbound_arrival_airport",
    "outbound_departure_time",
    "inbound_departure_time",
    "price",
    "block_status",
  ]);
  check("fields: tours status options are the lifecycle", tours.byKey.get("block_status")?.options, [...BLOCK_STATUSES]);
  check("fields: tours status label is Hebrew", tours.byKey.get("block_status")?.optionLabels?.operational, BLOCK_STATUS_LABELS.operational);
  check(
    "fields: tours operations group",
    tours.fields.filter((f) => f.group === TOURS_FIELD_GROUP).map((f) => f.key).sort(),
    [
      "cancel_reason", "cancellation_fee", "cancelled_at", "contract_id", "cost_child_price", "cost_tax",
      "first_cancellation_date", "inbound_airline_code", "names_deadline", "original_quantity", "requested_at",
      "reviewed_at", "season_label",
    ],
  );
  check("fields: contract and review mark are read-only", [tours.byKey.get("contract_id")?.readOnly, tours.byKey.get("reviewed_at")?.readOnly], [true, true]);
  check("fields: tours list shows series, season and status", ["series_name", "season_label", "block_status"].every((k) => tours.defaultVisible.includes(k as never)), true);
  check("fields: status filter per company", [blockStatusOptions(false).map((o) => o.label), blockStatusOptions(true).length], [["option", "confirmed", "ticketed"], BLOCK_STATUSES.length]);

  check(
    "route: both ends of an open-jaw",
    flightRouteLabel({ outbound_departure_airport: "TLV", outbound_arrival_airport: "LHR", inbound_departure_airport: "CDG", inbound_arrival_airport: "TLV" }),
    "TLV→LHR · CDG→TLV",
  );

  check("scope: an empty company id is refused", [throws(() => flightsOf({ id: "" })), throws(() => flightsOf({ id: undefined as unknown as string })), throws(() => flightsOf({ id: "1 or 1=1" }))], [true, true, true]);
  check("scope: product types", [sellsEvents({ productTypes: ["events"] }), sellsTours({ productTypes: ["events"] }), sellsTours({ productTypes: ["tours"] }), sellsEvents({ productTypes: ["tours"] })], [true, false, true, false]);
}

// ============================================================ part 2: data
type Row = { id: number; company_id: string; is_deleted: boolean | null; event_ids: number[] | null; notes: string | null; consumed_quantity: number };

// The script's own, deliberately UNSCOPED view of the table: the ground truth
// the scoped helpers are compared against. Never copy this into app code.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rawFlights = () => (supabase as any).from("flights");

async function all<T extends { id: number }>(makeQuery: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> }): Promise<T[]> {
  const { rows, error, truncated } = await fetchPaged<T>(makeQuery, 100_000);
  if (error) throw new Error(error.message);
  if (truncated) throw new Error("more than 100000 rows");
  return rows;
}

const companiesOf = (rows: { company_id?: string }[]) => [...new Set(rows.map((r) => r.company_id))].sort();

async function dataChecks() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url)) {
    fail("data: local database only", `NEXT_PUBLIC_SUPABASE_URL is "${url || "(unset)"}" - run with --env-file=.env.development.local (or --static-only)`);
    return;
  }
  ok("data: running against the local database");

  const ME = { id: MEGA_EVENTS_COMPANY_ID };
  const truth = await all<Row>(() => rawFlights().select("id, company_id, is_deleted, event_ids, notes, consumed_quantity").order("id", { ascending: true }));
  const meTruth = truth.filter((r) => r.company_id === MEGA_EVENTS_COMPANY_ID);
  const otherTruth = truth.filter((r) => r.company_id !== MEGA_EVENTS_COMPANY_ID);
  truthy("data: Mega Events flights exist", meTruth.length > 0, "no Mega Events flight in this database");
  truthy(
    "data: another company's flights exist (isolation can be proven)",
    otherTruth.length > 0,
    "no flight of a second company in this database - import the Mega Family blocks first",
  );
  if (meTruth.length === 0 || otherTruth.length === 0) return;
  const otherCompanyId = otherTruth[0].company_id;
  const OTHER = { id: otherCompanyId };
  const otherOfThat = otherTruth.filter((r) => r.company_id === otherCompanyId);
  const otherIds = otherTruth.map((r) => r.id);
  const meIds = meTruth.map((r) => r.id);
  console.log(`     ${meTruth.length} Mega Events flights, ${otherTruth.length} of other companies (${otherOfThat.length} in ${otherCompanyId})`);

  // The invariant the customer site relies on: it sells flights by event id.
  check("data: no flight of another company carries an event id", otherTruth.filter((r) => (r.event_ids ?? []).length > 0).map((r) => r.id), []);

  // ---- lists (getOfflineFlights in each company)
  const meList = await all<Row>(() => megaEventsFlights().select("id, company_id").order("outbound_departure_time", { ascending: true }).order("id", { ascending: true }));
  check("list: Mega Events scope returns Mega Events rows only", companiesOf(meList), [MEGA_EVENTS_COMPANY_ID]);
  check("list: Mega Events scope returns every Mega Events row", meList.length, meTruth.length);
  const otherList = await all<Row>(() => flightsOf(OTHER).select("id, company_id").order("outbound_departure_time", { ascending: true }).order("id", { ascending: true }));
  check("list: the other company's scope returns its rows only", companiesOf(otherList), [otherCompanyId]);
  check("list: the other company's scope returns every one of its rows", otherList.length, otherOfThat.length);

  // ---- lookups by id (getOfflineFlight, lockEventFlight, loadFlightState, createPreparedPackage, describeOfflineFlight by locked id, reservation lookups)
  const sample = [otherIds[0], otherIds[Math.floor(otherIds.length / 2)], otherIds[otherIds.length - 1]];
  const foreign: unknown[] = [];
  for (const id of sample) {
    const { data, error } = await megaEventsFlights().select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    foreign.push(data);
    const cheap = await megaEventsFlights().select("id,price,stops,airline_code").eq("id", id).order("price", { ascending: true }).limit(1);
    foreign.push(...(cheap.data ?? []));
  }
  check("by id: a block of another company is not found in the Mega Events scope", foreign.filter(Boolean), []);
  const { data: foreignIn } = await megaEventsFlights().select("id, initial_quantity, consumed_quantity, is_deleted").in("id", otherIds.slice(0, 300));
  check("by ids: .in() over another company's ids finds nothing (portal locked-flight check, bulk edits)", (foreignIn ?? []).length, 0);
  const { data: own } = await megaEventsFlights().select("id, company_id").eq("id", meIds[0]).maybeSingle();
  check("by id: a Mega Events flight is found in its own scope", own?.id, meIds[0]);
  const { data: meFromOther } = await flightsOf(OTHER).select("id").eq("id", meIds[0]).maybeSingle();
  check("by id: a Mega Events flight is not found from the other company", meFromOther, null);

  // ---- event-keyed reads (getFlightsByEventId, getLockableFlights, portal inventory, offer detail, hotel 'has a flight')
  const eventIds = [...new Set(meTruth.flatMap((r) => r.event_ids ?? []))].slice(0, 25);
  const byEvent: Row[] = [];
  for (const eventId of eventIds) {
    const { data, error } = await megaEventsFlights().select("id, company_id").contains("event_ids", [eventId]).eq("is_deleted", false);
    if (error) throw new Error(error.message);
    byEvent.push(...((data ?? []) as Row[]));
  }
  truthy("by event: linked flights are read", eventIds.length === 0 || byEvent.length > 0, "no flight found for any linked event");
  check("by event: only Mega Events flights", companiesOf(byEvent).filter((c) => c !== MEGA_EVENTS_COMPANY_ID), []);

  // ---- the hotel-to-flight picker (getRelevantFlightsForHotel): a date window wide enough to cover every block
  const { data: picker, error: pickerError } = await megaEventsFlights()
    .select("id, company_id, airline_code, metadata_name, outbound_departure_airport, outbound_arrival_airport, outbound_departure_time, inbound_arrival_time, price")
    .eq("is_deleted", false)
    .lte("outbound_departure_time", "2100-01-01")
    .gte("inbound_arrival_time", "2000-01-01")
    .order("outbound_departure_time", { ascending: true });
  if (pickerError) throw new Error(pickerError.message);
  check("picker: hotel flight picker offers Mega Events flights only", companiesOf((picker ?? []) as Row[]), [MEGA_EVENTS_COMPANY_ID]);
  check("picker: and every live one of them", (picker ?? []).length, meTruth.filter((r) => !r.is_deleted).length);

  // ---- price-sync exclusion list (base-price-sync offlineLinkedEventIds)
  const { data: linked } = await megaEventsFlights().select("id, company_id, event_ids");
  check("sync: the offline-linked event list reads Mega Events flights only", companiesOf((linked ?? []) as Row[]), [MEGA_EVENTS_COMPANY_ID]);

  // ---- exports (loadFlightsForExport is called as the route calls it)
  const base = "http://localhost/api/exports/flights";
  const meExport = await loadFlightsForExport(base, ME);
  check("export: Mega Events export holds Mega Events flights only", companiesOf(meExport), [MEGA_EVENTS_COMPANY_ID]);
  check("export: and every live one of them", meExport.length, meTruth.filter((r) => !r.is_deleted).length);
  check("export: ids of another company export nothing", (await loadFlightsForExport(`${base}?ids=${otherIds.slice(0, 50).join(",")}`, ME)).length, 0);
  const otherExport = await loadFlightsForExport(base, OTHER);
  check("export: the other company's export holds its flights only", companiesOf(otherExport), [otherCompanyId]);
  check("export: and every live one of them", otherExport.length, otherOfThat.filter((r) => !r.is_deleted).length);
  check("export: Mega Events ids export nothing from the other company", (await loadFlightsForExport(`${base}?ids=${meIds.join(",")}`, OTHER)).length, 0);
  truthy("export: rows carry both ends of the route", otherExport.every((f) => f.inbound_departure_airport && flightRouteLabel(f).includes(f.inbound_departure_airport)), "a row has no inbound_departure_airport");

  // ---- writes. Each one sets a column to the value it already has, so even a
  //      broken scope changes nothing; what is asserted is "no row matched".
  const victim = otherTruth[0];
  const { data: w1, error: e1 } = await megaEventsFlights().update({ notes: victim.notes }).eq("id", victim.id).select("id");
  if (e1) throw new Error(e1.message);
  check("write: an update by id from the Mega Events scope does not reach another company's block", (w1 ?? []).length, 0);
  const { data: w2, error: e2 } = await megaEventsFlights().update({ consumed_quantity: victim.consumed_quantity }).eq("id", victim.id).select("id");
  if (e2) throw new Error(e2.message);
  check("write: the consumed_quantity recompute does not reach another company's block", (w2 ?? []).length, 0);
  const bulkIds = otherTruth.filter((r) => !r.is_deleted).slice(0, 100).map((r) => r.id);
  const { data: w3, error: e3 } = await megaEventsFlights().update({ is_deleted: false }).in("id", bulkIds).select("id");
  if (e3) throw new Error(e3.message);
  check("write: a bulk update over another company's ids changes nothing", (w3 ?? []).length, 0);
  const meRow = meTruth[0];
  const { data: w4, error: e4 } = await flightsOf(OTHER).update({ notes: meRow.notes }).eq("id", meRow.id).select("id");
  if (e4) throw new Error(e4.message);
  check("write: the other company cannot update a Mega Events flight", (w4 ?? []).length, 0);
  const { data: w5, error: e5 } = await megaEventsFlights().update({ notes: meRow.notes }).eq("id", meRow.id).select("id");
  if (e5) throw new Error(e5.message);
  check("write: a Mega Events flight is still writable in its own scope", (w5 ?? []).map((r: { id: number }) => r.id), [meRow.id]);

  // ---- insert + move. One throw-away row in the other company, removed at the end.
  let createdId: number | null = null;
  try {
    const draft = {
      company_id: MEGA_EVENTS_COMPANY_ID, // what a forged payload would send - must be overwritten
      initial_quantity: 1, price: 0, duration: "PT2H", stops: 0, airline_code: "ZZ",
      outbound_departure_time: "2099-01-01T08:00:00", outbound_departure_airport: "TLV", outbound_arrival_airport: "LHR",
      outbound_arrival_time: "2099-01-01T10:00:00", outbound_duration: "PT1H", outbound_check_bags_included: false,
      outbound_cabin_bags_included: true, outbound_flight_number: "ZZ1",
      inbound_departure_time: "2099-01-05T08:00:00", inbound_departure_airport: "CDG", inbound_arrival_airport: "TLV",
      inbound_arrival_time: "2099-01-05T10:00:00", inbound_duration: "PT1H", inbound_check_bags_included: false,
      inbound_cabin_bags_included: true, inbound_flight_number: "ZZ2",
      metadata_iata: "ZZ", metadata_name: "selftest", metadata_logo: "", event_ids: [],
      notes: "flights-company-scope-selftest (safe to delete)", consumed_quantity: 0, is_deleted: false,
    };
    const { data: created, error: createError } = await flightsOf(OTHER).insert(draft).select("id, company_id");
    if (createError) throw new Error(createError.message);
    createdId = created[0].id as number;
    check("insert: company_id comes from the scope, not from the payload", created[0].company_id, otherCompanyId);
    const { data: seenByMe } = await megaEventsFlights().select("id").eq("id", createdId).maybeSingle();
    check("insert: the new block is invisible to Mega Events", seenByMe, null);
    const { data: moved, error: moveError } = await flightsOf(OTHER).update({ company_id: MEGA_EVENTS_COMPANY_ID, notes: draft.notes }).eq("id", createdId).select("id, company_id");
    if (moveError) throw new Error(moveError.message);
    check("update: a row cannot be moved to another company", (moved ?? []).map((r: { company_id: string }) => r.company_id), [otherCompanyId]);
    const { data: softDeleted } = await megaEventsFlights().update({ is_deleted: true }).eq("id", createdId).select("id");
    check("delete: a soft delete from the Mega Events scope does not reach it", (softDeleted ?? []).length, 0);
  } finally {
    if (createdId !== null) {
      // The throw-away row only; by id and by its marker, in the local database.
      const { error: cleanupError } = await rawFlights().delete().eq("id", createdId).eq("metadata_name", "selftest");
      if (cleanupError) fail("cleanup: remove the throw-away row", cleanupError.message);
    }
  }

  // ---- nothing moved. Only the rows this script wrote to are compared - other
  //      people may be working in the same local database at the same time.
  const touched = [...new Set([victim.id, meRow.id, ...bulkIds])];
  const before = truth.filter((r) => touched.includes(r.id));
  const after = await all<Row>(() => rawFlights().select("id, company_id, is_deleted, event_ids, notes, consumed_quantity").in("id", touched).order("id", { ascending: true }));
  check("data: every row the script wrote to is exactly as it was", [after.length, JSON.stringify(after) === JSON.stringify(before)], [before.length, true]);
  const { data: leftovers } = await rawFlights().select("id").eq("metadata_name", "selftest").eq("airline_code", "ZZ");
  check("data: the throw-away row is gone", (leftovers ?? []).length, 0);
}

async function main() {
  staticScan();
  pureChecks();
  if (STATIC_ONLY) console.log("     --static-only: data part skipped");
  else await dataChecks();
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error("FAIL selftest crashed:", error);
  process.exit(1);
});
