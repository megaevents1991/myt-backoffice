// Run: npx tsx scripts/reservation-itinerary-selftest.ts
// Build Your Euro Trip in the reservations screens (lib/itinerary/reservation-group.ts + -db.ts): the
// list chip, the sibling total, the flight legs - and, above all, that the list and the detail page keep
// working when the migration's columns (itinerary_group / _seq / _of) do not exist yet.
// No DB, no network: the Supabase client is a fake that answers what a real one answers.
import assert from "node:assert/strict";
import {
  buildItineraryGroup,
  formatDmy,
  formatHm,
  formatIls,
  itineraryChipLabel,
  legsOf,
  markOf,
  trainLegsOf,
  type ItineraryGroupDbRow,
} from "../lib/itinerary/reservation-group";
import {
  loadItineraryGroup,
  loadItineraryMarks,
  type ReservationsDb,
} from "../lib/itinerary/reservation-group-db";

// ── a fake Supabase client ──────────────────────────────────────────────────────────────────────
type Reply = { data?: unknown; error?: { code?: string; message: string } | null; throws?: unknown };

function fakeDb(reply: Reply) {
  const calls: string[] = [];
  const result = () => {
    if (reply.throws !== undefined) return Promise.reject(reply.throws);
    return Promise.resolve({ data: reply.data ?? null, error: reply.error ?? null });
  };
  const chain: Record<string, (...args: unknown[]) => unknown> = {
    select: (cols) => (calls.push(`select ${cols}`), chain),
    not: (col, op, val) => (calls.push(`not ${col} ${op} ${val}`), chain),
    eq: (col, val) => (calls.push(`eq ${col} ${val}`), chain),
    order: (col) => (calls.push(`order ${col}`), chain),
    limit: (n) => (calls.push(`limit ${n}`), result()),
    range: (from, to) => (calls.push(`range ${from}-${to}`), result()),
  };
  const db = { from: (table: string) => (calls.push(`from ${table}`), chain) } as unknown as ReservationsDb;
  return { db, calls };
}

/** Runs `fn` with console.error captured. */
async function capturingErrors<T>(fn: () => Promise<T>): Promise<{ value: T; errors: unknown[][] }> {
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void errors.push(args);
  try {
    return { value: await fn(), errors };
  } finally {
    console.error = original;
  }
}

const MISSING = { code: "42703", message: "column reservations.itinerary_group does not exist" };
const GROUP = "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b";

(async () => {
  // ── chip ────────────────────────────────────────────────────────────────────────────────────────
  assert.equal(itineraryChipLabel(1, 2), "יורו טריפ 1/2");
  assert.equal(itineraryChipLabel(3, 3), "יורו טריפ 3/3");
  assert.equal(itineraryChipLabel("2", "3"), "יורו טריפ 2/3", "numeric strings read too");
  for (const [s, o] of [[0, 2], [3, 2], [null, 2], [1, null], [undefined, undefined], [1.5, 2], ["x", 2]] as const) {
    assert.equal(itineraryChipLabel(s, o), null, `no chip for seq=${String(s)} of=${String(o)}`);
  }

  // ── formatters ──────────────────────────────────────────────────────────────────────────────────
  assert.equal(formatDmy("2027-05-13T16:00:00"), "13/05/2027");
  assert.equal(formatHm("2027-05-13T16:00:00"), "16:00");
  assert.equal(formatHm("2027-05-13"), null, "a bare date has no time");
  assert.equal(formatDmy("2027-05-13"), "13/05/2027");
  assert.equal(formatDmy("garbage"), null);
  assert.equal(formatDmy(undefined), null);
  assert.equal(formatIls(1000), "₪1,000");
  assert.equal(formatIls(2200.6), "₪2,200.6");

  // ── legs ────────────────────────────────────────────────────────────────────────────────────────
  const flight = {
    id: "1",
    airline: "LY",
    legs: [
      { departureAirport: "TLV", arrivalAirport: "CDG", departureTime: "2027-05-12T08:30:00", arrivalTime: "2027-05-12T12:45:00", flightNumber: "LY323" },
      { departureAirport: "CDG", arrivalAirport: "LHR", departureTime: "2027-05-15T21:50:00", arrivalTime: "2027-05-16T00:05:00", flightNumber: "AF1280", operatedBy: "CityJet" },
      { departureAirport: "LHR", arrivalAirport: "TLV", departureTime: "2027-05-18T10:00:00", arrivalTime: "2027-05-18T17:30:00" },
    ],
    trainLegs: [{ from: "פריז", to: "לונדון", date: "2027-05-13" }],
  };
  const legs = legsOf(flight);
  assert.equal(legs.length, 3);
  assert.deepEqual(legs[0], {
    from: "TLV", to: "CDG", date: "12/05/2027", departs: "08:30", arrives: "12:45",
    arrivalDate: null, flightNumber: "LY323", operatedBy: null,
  });
  assert.equal(legs[1].arrivalDate, "16/05/2027", "an overnight leg names its landing day");
  assert.equal(legs[1].operatedBy, "CityJet");
  assert.equal(legs[2].flightNumber, null, "a leg without a number is still listed");
  assert.deepEqual(trainLegsOf(flight), [{ from: "פריז", to: "לונדון", date: "13/05/2027" }]);
  // garbage never throws and never invents a leg
  assert.deepEqual(legsOf(null), []);
  assert.deepEqual(legsOf({}), []);
  assert.deepEqual(legsOf({ legs: "x" }), []);
  assert.equal(legsOf({ legs: [null, 5, "x", {}, { departureAirport: "AMS" }] }).length, 1);
  assert.deepEqual(trainLegsOf({ trainLegs: [null, {}, { from: "A", to: "B", date: "soon" }] }), [{ from: "A", to: "B", date: "soon" }]);

  // ── the group ───────────────────────────────────────────────────────────────────────────────────
  const row = (patch: Partial<ItineraryGroupDbRow> & { id: number }): ItineraryGroupDbRow => ({
    itinerary_seq: 1, itinerary_of: 3, status: "Pending", final_purchase_price_ils: 0, event_id: null,
    event_order_info: {}, flight_order_info: {}, hotel_order_info: {}, is_deleted: null, ...patch,
  });
  const rows: ItineraryGroupDbRow[] = [
    row({ id: 103, itinerary_seq: 3, final_purchase_price_ils: "700.30", event_id: 703,
      event_order_info: { name: "Event C", date: "2027-05-17T19:00:00" }, hotel_order_info: { name: "Hotel C" } }),
    row({ id: 101, itinerary_seq: 1, final_purchase_price_ils: 1000.1, event_id: 701, flight_order_info: flight,
      event_order_info: { name: "Event A", date: "2027-05-12T20:00:00" }, hotel_order_info: { name: "Hotel A" } }),
    row({ id: 102, itinerary_seq: 2, final_purchase_price_ils: 500.2, event_id: 702, status: "Paid",
      event_order_info: { events: [{ name: "Event B", date: "2027-05-15" }] } }),
  ];
  const g = buildItineraryGroup(GROUP, rows);
  assert.ok(g);
  assert.deepEqual(g.members.map((m) => m.id), [101, 102, 103], "siblings come in trip order whatever order they were read in");
  assert.equal(g.of, 3);
  assert.equal(g.totalIls, 2200.6, "total = sum of the rows' shares, without float noise (1000.1 + 500.2 + '700.30')");
  assert.equal(g.totalPartial, false);
  assert.equal(g.flightHolderId, 101, "the flight is read from seq 1");
  assert.equal(g.legs.length, 3);
  assert.equal(g.trainLegs.length, 1);
  assert.deepEqual(
    g.members.map((m) => [m.eventName, m.eventDate, m.hotelName, m.status, m.priceIls]),
    [
      ["Event A", "12/05/2027", "Hotel A", "Pending", 1000.1],
      ["Event B", "15/05/2027", null, "Paid", 500.2],
      ["Event C", "17/05/2027", "Hotel C", "Pending", 700.3],
    ],
    "the event is read from either shape of event_order_info; a `{}` hotel is no hotel",
  );
  // a row with no price: the total is a lower bound and says so
  const partial = buildItineraryGroup(GROUP, [row({ id: 1, final_purchase_price_ils: null }), row({ id: 2, itinerary_seq: 2, final_purchase_price_ils: 50 })]);
  assert.equal(partial?.totalIls, 50);
  assert.equal(partial?.totalPartial, true);
  // a soft-deleted sibling is listed, flagged, and still counted in the trip total
  const withDeleted = buildItineraryGroup(GROUP, [row({ id: 1, final_purchase_price_ils: 10 }), row({ id: 2, itinerary_seq: 2, final_purchase_price_ils: 5, is_deleted: "10-21-2026" })]);
  assert.deepEqual(withDeleted?.members.map((m) => m.deleted), [false, true]);
  assert.equal(withDeleted?.totalIls, 15);
  // no flight anywhere -> no legs, no holder
  const noFlight = buildItineraryGroup(GROUP, [row({ id: 1 }), row({ id: 2, itinerary_seq: 2 })]);
  assert.equal(noFlight?.flightHolderId, null);
  assert.deepEqual(noFlight?.legs, []);
  // a flight that sits on a row other than seq 1 (a hand-edited trip) is still shown
  const moved = buildItineraryGroup(GROUP, [row({ id: 1 }), row({ id: 2, itinerary_seq: 2, flight_order_info: flight })]);
  assert.equal(moved?.flightHolderId, 2);
  assert.equal(moved?.legs.length, 3);
  assert.equal(buildItineraryGroup(GROUP, []), null);
  assert.equal(g.of === 3 && g.members.length < g.of, false, "complete trip");
  const lone = buildItineraryGroup(GROUP, [row({ id: 5, itinerary_of: 2 })]);
  assert.equal(lone?.of, 2, "a trip with a missing sibling still says how many it should have");
  assert.equal(lone?.members.length, 1);

  // ── marks: a well-formed trip row only ─────────────────────────────────────────────────────────
  assert.equal(markOf({ id: 1, itinerary_group: null, itinerary_seq: null, itinerary_of: null }), null);
  assert.equal(markOf({ id: 1, itinerary_group: GROUP, itinerary_seq: 3, itinerary_of: 2 }), null, "seq > of is not a chip");
  assert.deepEqual(markOf({ id: 1, itinerary_group: GROUP, itinerary_seq: 2, itinerary_of: 3 }), {
    itinerary_group: GROUP, itinerary_seq: 2, itinerary_of: 3,
  });

  // ── the list read is best effort: it works with the columns and WITHOUT them ───────────────────
  {
    const { db, calls } = fakeDb({
      data: [
        { id: 11, itinerary_group: GROUP, itinerary_seq: 1, itinerary_of: 2 },
        { id: 12, itinerary_group: GROUP, itinerary_seq: 2, itinerary_of: 2 },
        { id: 13, itinerary_group: GROUP, itinerary_seq: 3, itinerary_of: 2 }, // malformed: no chip
        { id: 14, itinerary_group: "", itinerary_seq: 1, itinerary_of: 2 }, // malformed: no chip
        { id: 15, itinerary_group: "other", itinerary_seq: "2", itinerary_of: "3" },
      ],
    });
    const { value: marks, errors } = await capturingErrors(() => loadItineraryMarks(db));
    assert.deepEqual([...marks.keys()].sort(), [11, 12, 15]);
    assert.deepEqual(marks.get(11), { itinerary_group: GROUP, itinerary_seq: 1, itinerary_of: 2 });
    assert.equal(errors.length, 0);
    // it asks ONLY for trip rows and for exactly the three columns (+ id) - never the whole table
    assert.ok(calls.includes("from reservations"));
    assert.ok(calls.includes("select id,itinerary_group,itinerary_seq,itinerary_of"));
    assert.ok(calls.includes("not itinerary_group is null"));
  }
  for (const [name, error] of [
    ["42703 (Postgres: column does not exist)", MISSING],
    ["PGRST204 (PostgREST schema cache lacks the column)", { code: "PGRST204", message: "Could not find the 'itinerary_group' column of 'reservations' in the schema cache" }],
    ["message-only", { message: 'column "itinerary_group" does not exist' }],
  ] as const) {
    const { db } = fakeDb({ error });
    const { value, errors } = await capturingErrors(() => loadItineraryMarks(db));
    assert.equal(value.size, 0, `${name}: no chips, no throw`);
    assert.equal(errors.length, 0, `${name}: the expected deploy-before-migration window is not logged as an error`);
  }
  {
    const { db } = fakeDb({ error: { code: "57014", message: "canceling statement due to statement timeout" } });
    const { value, errors } = await capturingErrors(() => loadItineraryMarks(db));
    assert.equal(value.size, 0, "any other failure: still no throw, still no chips");
    assert.equal(errors.length, 1, "...but it IS logged");
  }
  {
    const { db } = fakeDb({ throws: new Error("fetch failed") });
    const { value, errors } = await capturingErrors(() => loadItineraryMarks(db));
    assert.equal(value.size, 0, "a thrown error never escapes into the list");
    assert.equal(errors.length, 1);
  }

  // ── the detail read: null on anything, never a throw ───────────────────────────────────────────
  {
    const { db, calls } = fakeDb({ data: [] });
    assert.equal(await loadItineraryGroup(db, "not-a-uuid"), null);
    assert.equal(calls.length, 0, "a non-uuid group never reaches the database");
  }
  {
    const { db, calls } = fakeDb({ data: rows });
    const out = await loadItineraryGroup(db, GROUP);
    assert.deepEqual(out?.members.map((m) => m.id), [101, 102, 103]);
    assert.equal(out?.totalIls, 2200.6);
    assert.ok(calls.includes(`eq itinerary_group ${GROUP}`));
    assert.ok(calls.some((c) => c.startsWith("select id,itinerary_seq,itinerary_of,status,final_purchase_price_ils")));
  }
  {
    const { db } = fakeDb({ error: MISSING });
    const { value, errors } = await capturingErrors(() => loadItineraryGroup(db, GROUP));
    assert.equal(value, null, "columns missing: the panel is hidden, the page is fine");
    assert.equal(errors.length, 0);
  }
  {
    const { db } = fakeDb({ error: { code: "XX000", message: "boom" } });
    const { value, errors } = await capturingErrors(() => loadItineraryGroup(db, GROUP));
    assert.equal(value, null);
    assert.equal(errors.length, 1);
  }
  {
    const { db } = fakeDb({ throws: new Error("fetch failed") });
    const { value, errors } = await capturingErrors(() => loadItineraryGroup(db, GROUP));
    assert.equal(value, null);
    assert.equal(errors.length, 1);
  }
  {
    const { db } = fakeDb({ data: [] });
    assert.equal(await loadItineraryGroup(db, GROUP), null, "a group with no rows is no group");
  }

  console.log("reservation-itinerary-selftest: ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
