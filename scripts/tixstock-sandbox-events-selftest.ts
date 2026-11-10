// Run: npx tsx scripts/tixstock-sandbox-events-selftest.ts
// The two hidden test events of TixStock's health check (lib/services/tixstock-sandbox-events.ts): which tickets a
// sandbox feed becomes, and the exact event rows scripts/tixstock-sandbox-test-events.ts writes. No DB, no network.
// What matters most here: the rows are test events that are not listed, not packages and carry no price of a real
// event; a ticket's price is the card's (the cheapest listing, rounded up); and the feed's "false" is false.
import assert from "node:assert/strict";
import {
  SANDBOX_EVENT_NAMES,
  SANDBOX_TIXSTOCK_EVENT_ID,
  listingFacts,
  sandboxEventRow,
  sandboxTickets,
} from "../lib/services/tixstock-sandbox-events";

type Listing = Record<string, unknown>;

/** A listing as the sandbox feed sends it (10.11.2026): amounts and booleans are strings. */
const listing = (over: {
  id?: string;
  category?: string;
  amount?: string;
  currency?: string;
  quantity?: number;
  display?: number;
  lead?: unknown;
  type?: string;
  split?: string;
  instant?: unknown;
}): Listing => ({
  id: over.id ?? "L1",
  requires_lead_booker: over.lead ?? "false",
  ticket: { type: over.type ?? "eTicket", split_type: over.split ?? "No Preferences", instant_download: over.instant ?? "false" },
  number_of_tickets_for_sale: { quantity_available: over.quantity ?? 2, display_quantity: over.display ?? 0, split_quantity: 0 },
  seat_details: { category: over.category ?? "Est 1 Laterale", section: "111", row: "5" },
  proceed_price: { currency: over.currency ?? "USD", amount: over.amount ?? "60.00" },
  delivery: { type: "SHIPPING" },
});

const ids = () => {
  let n = 0;
  return () => `new-${++n}`;
};

const run = (name: string, fn: () => void) => {
  try {
    fn();
  } catch (e) {
    console.error(`FAILED: ${name}`);
    throw e;
  }
};

run("cheapest per category, rounded up", () => {
  const tickets = sandboxTickets(
    [listing({ id: "a", amount: "80.00" }), listing({ id: "b", amount: "59.20" }), listing({ id: "c", category: "Est 1 Centrale", amount: "6.73" })],
    SANDBOX_TIXSTOCK_EVENT_ID,
    [],
    ids(),
  );
  assert.deepEqual(
    tickets.map((t) => [t.category, t.price]),
    [
      ["Est 1 Laterale", 60],
      ["Est 1 Centrale", 7],
    ],
    "the price of the card: the cheapest listing of the category, rounded up to a whole dollar",
  );
  assert.deepEqual(tickets[0], {
    id: "new-1",
    category: "Est 1 Laterale",
    description: "",
    colorOnTheMap: "rgb(5, 32, 60)",
    price: 60,
    eid: SANDBOX_TIXSTOCK_EVENT_ID,
    available: true,
    supplier: "tixstock",
  });
});

run("listings that get no card are not priced", () => {
  const tickets = sandboxTickets(
    [
      listing({ id: "sold", amount: "5.00", quantity: 0 }),
      listing({ id: "lead", amount: "6.00", lead: "true" }),
      listing({ id: "lead2", amount: "6.50", lead: true }),
      listing({ id: "gbp", amount: "7.00", currency: "GBP" }),
      listing({ id: "free", amount: "0.00" }),
      listing({ id: "ok", amount: "40.00", lead: "false" }),
    ],
    SANDBOX_TIXSTOCK_EVENT_ID,
    [],
    ids(),
  );
  assert.deepEqual(tickets.map((t) => t.price), [40], 'the string "false" is not a lead booker; a price in another currency is never guessed');
});

run("one row per category whatever the spelling", () => {
  const tickets = sandboxTickets(
    [listing({ id: "a", category: "Categoría 2 (CAT2) - Fondo", amount: "90" }), listing({ id: "b", category: "categoria 2 fondo", amount: "70" })],
    SANDBOX_TIXSTOCK_EVENT_ID,
    [],
    ids(),
  );
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].category, "Categoría 2 (CAT2) - Fondo", "the first spelling the feed gave");
  assert.equal(tickets[0].price, 70);
});

run("a second run keeps what the editor added", () => {
  const existing = [
    { id: "keep-1", category: "Est 1 Laterale", description: "", colorOnTheMap: "rgb(1, 2, 3)", price: 60, eid: "x", available: true, supplier: "tixstock", zoneId: "z-east", zoneLabel: "מזרח" },
    { id: "keep-2", category: "Curva Sud", description: "", colorOnTheMap: "rgb(5, 32, 60)", price: 30, eid: "x", available: true, supplier: "tixstock" },
  ];
  const tickets = sandboxTickets(
    [listing({ id: "a", category: "est 1 laterale", amount: "44.10" }), listing({ id: "n", category: "Tribuna Nord", amount: "20" })],
    SANDBOX_TIXSTOCK_EVENT_ID,
    existing,
    ids(),
  );
  assert.deepEqual(tickets[0], { ...existing[0], price: 45, eid: SANDBOX_TIXSTOCK_EVENT_ID, available: true }, "same id, same zone and colour, the new price");
  assert.deepEqual(tickets[1], existing[1], "a category the feed no longer has is left exactly as it is (orders may point at it)");
  assert.deepEqual([tickets[2].id, tickets[2].category, tickets[2].price], ["new-1", "Tribuna Nord", 20]);
  assert.equal(tickets.length, 3);
});

run("what a listing says, with the feed's strings read as they are", () => {
  assert.deepEqual(listingFacts(listing({ id: "L7", amount: "6.73", quantity: 10, display: 2, instant: "true", type: "mobile", split: "All Together" })), {
    id: "L7",
    category: "Est 1 Laterale",
    section: "111",
    row: "5",
    type: "mobile",
    splitType: "All Together",
    deliveryType: "SHIPPING",
    leadBooker: false,
    instantDownload: true,
    quantity: 10,
    displayQuantity: 2,
    amount: 6.73,
    currency: "USD",
  });
  assert.equal(listingFacts(listing({ lead: "true" })).leadBooker, true);
  assert.equal(listingFacts({ id: "bare" }).amount, null, "a listing with no price has none - never 0");
});

run("the two event rows", () => {
  const tickets = sandboxTickets([listing({})], SANDBOX_TIXSTOCK_EVENT_ID, [], ids());
  const site = sandboxEventRow("sandbox_site", tickets);
  const office = sandboxEventRow("sandbox_office", tickets);

  assert.deepEqual(site, {
    name: "TEST · Juventus FC vs Como (TixStock sandbox)",
    name_english: "Juventus FC vs Como",
    type: "tx_event",
    date: "2027-06-11",
    description: "",
    def_date_depart: "2027-06-10",
    def_date_return: "2027-06-12",
    location: { name: "טורינו, איטליה", latitude: 45.1096, longitude: 7.6413, city_iata: "TRN", country_code: "IT" },
    card_image_url: "",
    tags: "",
    is_test: true,
    is_hidden: false,
    is_deleted: null,
    package_mode: "ticket_only",
    skip_flight: true,
    ticket_only_markup: 5,
    base_flight_price: 0,
    base_hotel_price: 0,
    usual_price: 0,
    tickets_and_rates: tickets,
    tixstock_booking: "sandbox_site",
  });
  assert.deepEqual(office, { ...site, name: "TEST · Juventus FC vs Como (TixStock sandbox · office)", tixstock_booking: "sandbox_office" });
  assert.deepEqual(SANDBOX_EVENT_NAMES, { sandbox_site: site.name, sandbox_office: office.name });
  assert.notEqual(site.name, office.name, "the script finds its rows by name");
  for (const key of Object.keys(site)) {
    assert.ok(!/ready_package|campaign|art_image|map_image|markup_(ticket|flight|hotel)|event_additional_markup/.test(key), `${key}: nothing of a real event is carried`);
  }
});

console.log("tixstock-sandbox-events-selftest: all passed");
