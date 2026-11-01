// Self-test for a block flown back by another airline (lib/flight-return-airline.ts).
//   npx tsx scripts/flight-return-airline-selftest.ts
import assert from "node:assert/strict";
import {
  NO_RETURN_AIRLINE,
  flownBackByAnother,
  returnAirlineColumns,
  returnAirlineOf,
  returnAirlineProblem,
  withReturnAirlineNames,
} from "../lib/flight-return-airline";
import { assertFlightValues, pickFlightColumns } from "../lib/actions/offline-flight-columns";
import { fillReturnAirlineNames, lookupAirlineNames } from "../lib/services/airline-names";

const NONE = { inbound_airline_code: null, inbound_metadata_name: null, inbound_metadata_logo: null };
const swiss = { code: "LX", name: "Swiss", logo: "https://x/SWR.png" };

// ── flownBackByAnother ──
assert.equal(flownBackByAnother("LX", "LH"), true);
assert.equal(flownBackByAnother("LH", "LH"), false, "the same airline both ways");
assert.equal(flownBackByAnother(" lh ", "LH"), false, "a typed code is compared clean");
assert.equal(flownBackByAnother("", "LH"), false);
assert.equal(flownBackByAnother(null, "LH"), false);

// ── what the forms write ──
assert.deepEqual(returnAirlineColumns(NO_RETURN_AIRLINE, "LH"), NONE, "an empty box is no return airline");
assert.deepEqual(returnAirlineColumns({ ...swiss, code: "LH" }, "LH"), NONE, "the outbound airline typed again is no return airline");
assert.deepEqual(
  returnAirlineColumns({ code: " lx ", name: " Swiss ", logo: "" }, "LH"),
  { inbound_airline_code: "LX", inbound_metadata_name: "Swiss", inbound_metadata_logo: null },
);

// ── what stops a form ──
assert.equal(returnAirlineProblem(NO_RETURN_AIRLINE, "LH"), null);
assert.equal(returnAirlineProblem(swiss, "LH"), null);
assert.equal(returnAirlineProblem({ code: "LH", name: "", logo: "" }, "LH"), null, "the same airline needs no name");
assert.match(returnAirlineProblem({ code: "LX", name: "", logo: "" }, "LH") ?? "", /Look up/, "a new code with no name is refused");
assert.match(returnAirlineProblem({ code: "LH/LX", name: "x", logo: "" }, "LH") ?? "", /2-3/, "two codes in one box");
assert.equal(
  returnAirlineProblem({ code: "LX", name: "", logo: "" }, "LH", "LX"),
  null,
  "a stored code with no name never stops an unrelated edit of an older row",
);
assert.match(returnAirlineProblem({ code: "OS", name: "", logo: "" }, "LH", "LX") ?? "", /Look up/, "a changed code still needs its name");

// ── reading a row back ──
assert.deepEqual(returnAirlineOf({}), NO_RETURN_AIRLINE);
assert.deepEqual(
  returnAirlineOf({ inbound_airline_code: "LX", inbound_metadata_name: "Swiss", inbound_metadata_logo: null }),
  { code: "LX", name: "Swiss", logo: "" },
);

// ── a name never outlives its code (every write path) ──
assert.deepEqual(withReturnAirlineNames({ price: 1 }), { price: 1 }, "a write that does not name the airline leaves it alone");
assert.deepEqual(withReturnAirlineNames({ inbound_airline_code: "os" }), {
  inbound_airline_code: "OS",
  inbound_metadata_name: null,
  inbound_metadata_logo: null,
}, "a sheet cell or a bulk edit writes the code alone: Swiss's name must not stay on OS");
assert.deepEqual(withReturnAirlineNames({ inbound_airline_code: "", inbound_metadata_name: "Swiss" }), NONE, "clearing the code clears the name");
assert.deepEqual(
  withReturnAirlineNames({ inbound_airline_code: "LX", inbound_metadata_name: "Swiss", inbound_metadata_logo: "u" }),
  { inbound_airline_code: "LX", inbound_metadata_name: "Swiss", inbound_metadata_logo: "u" },
);

// ── the columns gate ──
assert.deepEqual(
  pickFlightColumns({ price: 1, inbound_airline_code: "LX", inbound_metadata_name: "Swiss", inbound_metadata_logo: "u" }),
  { price: 1 },
  "Mega Events never writes the return airline",
);
assert.deepEqual(
  pickFlightColumns({ inbound_airline_code: "LX", inbound_metadata_name: "Swiss", inbound_metadata_logo: "u" }, { tours: true }),
  { inbound_airline_code: "LX", inbound_metadata_name: "Swiss", inbound_metadata_logo: "u" },
);
assert.deepEqual(
  pickFlightColumns({ inbound_airline_code: "os" }, { tours: true }),
  { inbound_airline_code: "OS", inbound_metadata_name: null, inbound_metadata_logo: null },
);
assert.throws(() => assertFlightValues({ inbound_airline_code: "SWISS" }, { tours: true }), /Return airline/, "a word typed in a bulk edit reads as our message");
assert.doesNotThrow(() => assertFlightValues({ inbound_airline_code: "LX" }, { tours: true }));
assert.doesNotThrow(() => assertFlightValues({ inbound_airline_code: null }, { tours: true }));

// ── the save fills what a sheet cell or a bulk edit cannot type ──
(async () => {
  const asked: string[] = [];
  const lookup = async (code: string) => {
    asked.push(code);
    return code === "LX" ? { name: "Swiss", logo: "https://x/SWR.png" } : null;
  };
  const codeAlone = (code: string) => ({ inbound_airline_code: code, inbound_metadata_name: null, inbound_metadata_logo: null });

  assert.deepEqual(await fillReturnAirlineNames({ price: 1 }, "LH", lookup), { price: 1 });
  assert.deepEqual(asked, [], "no return airline in the write, no lookup");

  assert.deepEqual(await fillReturnAirlineNames(codeAlone("LX"), "LH", lookup), {
    inbound_airline_code: "LX",
    inbound_metadata_name: "Swiss",
    inbound_metadata_logo: "https://x/SWR.png",
  });
  assert.deepEqual(asked, ["LX"]);

  asked.length = 0;
  assert.deepEqual(await fillReturnAirlineNames(codeAlone("LH"), "LH", lookup), codeAlone("LH"), "the outbound airline again");
  assert.deepEqual(await fillReturnAirlineNames(NONE, "LH", lookup), NONE, "a cleared code");
  const named = { inbound_airline_code: "LX", inbound_metadata_name: "Swiss Intl", inbound_metadata_logo: null };
  assert.deepEqual(await fillReturnAirlineNames(named, "LH", lookup), named, "a name a person typed stays");
  assert.deepEqual(asked, [], "none of those needs a lookup");

  assert.deepEqual(await fillReturnAirlineNames(codeAlone("ZZ"), "LH", lookup), codeAlone("ZZ"), "lookup found nothing: the code alone is saved");
  const down = async () => {
    throw new Error("avcodes is down");
  };
  assert.deepEqual(await fillReturnAirlineNames(codeAlone("LX"), "LH", down), codeAlone("LX"), "a lookup that throws never fails the save");

  // ── a synthetic avcodes page, no network ──
  const page = (records: string) => `<html><body>Number of Records found ${records}</body></html>`;
  const answers: Record<string, string> = {
    LX: page("1 This is Current Data Swiss Full Name: Swiss International Air Lines IATA Code: LX ICAO Code: SWR FAA 3LD Code: x"),
    Q9: page("1 This is Current Data Small Air Full Name: Small Air Ltd IATA Code: Q9 ICAO Code: FAA 3LD Code: x"),
    ZZ: page("0"),
  };
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    calls++;
    const code = new URLSearchParams(String(init?.body)).get("iataairl") ?? "";
    return new Response(answers[code] ?? "not the result page", { status: 200 });
  }) as typeof fetch;
  try {
    assert.deepEqual(await lookupAirlineNames("lx"), { name: "Swiss", logo: "https://www.avcodes.co.uk/images/logos/SWR.png" });
    assert.deepEqual(await lookupAirlineNames("LX"), { name: "Swiss", logo: "https://www.avcodes.co.uk/images/logos/SWR.png" });
    assert.equal(calls, 1, "a sheet save of many rows asks avcodes once per code");
    assert.deepEqual(await lookupAirlineNames("Q9"), { name: "Small Air", logo: null }, "an airline with no ICAO code keeps its name, no logo");
    assert.equal(await lookupAirlineNames("ZZ"), null, "avcodes has no record");
    assert.equal(await lookupAirlineNames("SWISS"), null, "not a code: avcodes is not asked");
    assert.equal(await lookupAirlineNames("A1"), null, "a page we cannot read is no name");
  } finally {
    globalThis.fetch = realFetch;
  }

  console.log("flight-return-airline selftest passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
