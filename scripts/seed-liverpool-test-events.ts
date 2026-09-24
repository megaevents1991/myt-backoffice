/**
 * Seed two Liverpool TEST events (is_test = true) from the two live suppliers, the way the
 * Real Madrid two-supplier pilot (event 1130) was built - for Alon's QA of the lodging feature:
 *
 *   A. Liverpool FC vs Arsenal FC (Anfield, 01.11.2026): a PACKAGE whose flight city is London and
 *      whose event city is Liverpool - lodging_mode choice_split (the "הלינה ב:" line + "מפוצל").
 *   B. Liverpool FC vs Manchester City FC (Anfield, 11.10.2026): TICKET-ONLY (package_mode).
 *
 * Tickets: LiveTickets stock via the real client (fetchLiveTicketsStock + liveTicketsPriceUsd) and
 * TixStock listings via the feed the editor's "Source Tickets" uses (cheapest per category with
 * qty >= 2, +GBP markup, USD) - same maths as the editor / ticket-price-sync.
 *
 * Run from the repo root:  npx tsx scripts/seed-liverpool-test-events.ts [--dry]
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

// .env.local into process.env BEFORE the app modules load (they read env at import).
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

const DRY = process.argv.includes("--dry");

const LONDON = { name: "לונדון, בריטניה", latitude: 51.509865, longitude: -0.118092, city_iata: "LON", country_code: "GB" };
const LIVERPOOL = { name: "ליברפול", latitude: 53.4084, longitude: -2.9916, country_code: "GB" };
const ANFIELD_MAP = "https://tixstock.s3.eu-west-2.amazonaws.com/ee/maps/Liverpool%20-%20Anfield%20-%20EPL%20-%202024-25.svg";

const FIXTURES = [
  {
    key: "arsenal",
    name: "ליברפול - ארסנל · טסט עיר משחק (טיסה ללונדון)",
    name_english: "Liverpool FC vs Arsenal FC",
    date: "2026-11-01",
    tx: "01kv7nfxthga6t59y4ggspdmre",
    lt: "2325021",
    mode: "lodging" as const,
  },
  {
    key: "mancity",
    name: "ליברפול - מנצ'סטר סיטי · טסט כרטיס בלבד",
    name_english: "Liverpool FC vs Manchester City FC",
    date: "2026-10-11",
    tx: "01kv7nmj4kncn330nk1t1e39am",
    lt: "2325012",
    mode: "ticket_only" as const,
  },
];

type TxListing = {
  seat_details?: { category?: string };
  number_of_tickets_for_sale?: { quantity_available?: number };
  proceed_price?: { amount?: string; currency?: string };
  face_value?: { amount?: string; currency?: string };
};

async function tixstockListings(eventId: string): Promise<TxListing[]> {
  const base = process.env.NEXT_SECRET_TIXSTOCK_API_URL, token = process.env.NEXT_SECRET_TIXSTOCK_TOKEN;
  if (!base || !token) throw new Error("NEXT_SECRET_TIXSTOCK_API_URL/TOKEN missing");
  const out: TxListing[] = [];
  for (let page = 1, last = 1; page <= last && page <= 40; page++) {
    const url = new URL(`${base}/tickets/feed`);
    url.searchParams.set("event_id", eventId);
    url.searchParams.set("per_page", "50");
    url.searchParams.set("page", String(page));
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (!res.ok) throw new Error(`TixStock ${res.status}`);
    const data = (await res.json()) as { data?: TxListing[]; meta?: { last_page?: number } };
    if (page === 1) last = data.meta?.last_page ?? 1;
    out.push(...(data.data ?? []));
  }
  return out;
}

const amountOf = (t: TxListing) => {
  const p = Number.parseFloat(t.proceed_price?.amount || "0");
  if (Number.isFinite(p) && p > 0) return p;
  const f = Number.parseFloat(t.face_value?.amount || "0");
  return Number.isFinite(f) ? f : 0;
};

async function main() {
  const { supabase } = await import("../lib/supabase-server");
  const { fetchLiveTicketsStock, liveTicketsPriceUsd } = await import("../lib/services/livetickets-offers");
  const { supplierPriceUsd } = await import("../lib/suppliers");
  const { multiCurrencyExchangeRateService } = await import("../lib/services/ticket-price-sync");
  const { TX_TICKET_COLOR } = await import("../lib/tixstock-map");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  await multiCurrencyExchangeRateService.updateAllExchangeRates();
  const toUsd = (amount: number, cur: "USD" | "EUR" | "GBP" | "ILS") =>
    cur === "USD" ? amount : multiCurrencyExchangeRateService.convertToUSD(amount, cur);

  // Liverpool as a saved location (no IATA - it is never a flight city).
  const { data: locRows } = await db.from("locations").select("id").ilike("name", "%ליברפול%").limit(1);
  if (!locRows?.length) {
    console.log("locations: adding ליברפול");
    if (!DRY) {
      const { error } = await db.from("locations").insert({ ...LIVERPOOL, city_iata: null });
      if (error) throw error;
    }
  } else console.log("locations: ליברפול exists", locRows[0].id);

  for (const fx of FIXTURES) {
    const { data: existing } = await db.from("events").select("id").eq("name", fx.name).is("is_deleted", null).limit(1);
    if (existing?.length) { console.log(`${fx.key}: already exists as event ${existing[0].id} - skipping`); continue; }

    // LiveTickets
    const tickets: Record<string, unknown>[] = [];
    const stock = await fetchLiveTicketsStock(fx.lt);
    if (!stock || stock === "SOLD_OUT") console.warn(`${fx.key}: LiveTickets stock unavailable (${stock})`);
    else {
      for (const c of stock.categories) {
        if (!c.sellable && !c.nonInstantOnly) continue;
        tickets.push({
          id: c.id, category: c.title, supplierCategory: c.title, description: c.description,
          colorOnTheMap: "", price: liveTicketsPriceUsd(c.cost, stock.currency),
          supplier: "livetickets", eid: fx.lt, available: true,
          ...(c.nonInstantOnly ? { nonInstant: true } : {}),
        });
      }
    }
    // TixStock - cheapest per category with qty >= 2 (the editor's rule)
    const listings = await tixstockListings(fx.tx);
    const byCat = new Map<string, TxListing[]>();
    for (const t of listings) {
      const cat = (t.seat_details?.category || "").trim();
      if (!cat || (t.number_of_tickets_for_sale?.quantity_available ?? 0) < 2 || amountOf(t) <= 0) continue;
      byCat.set(cat, [...(byCat.get(cat) ?? []), t]);
    }
    for (const [cat, rows] of byCat) {
      const cheapest = rows.reduce((m, t) => (amountOf(t) < amountOf(m) ? t : m));
      const cur = ((cheapest.proceed_price?.currency || cheapest.face_value?.currency || "GBP").toUpperCase()) as "USD" | "EUR" | "GBP" | "ILS";
      tickets.push({
        id: randomUUID(), category: cat, description: "", colorOnTheMap: TX_TICKET_COLOR,
        price: supplierPriceUsd(amountOf(cheapest), cur, toUsd), eid: fx.tx, available: true,
      });
    }
    console.log(`${fx.key}: ${tickets.length} tickets (livetickets ${tickets.filter((t) => t.supplier === "livetickets").length}, tixstock ${byCat.size})`);

    const depart = new Date(fx.date + "T00:00:00Z"); depart.setUTCDate(depart.getUTCDate() - 2);
    const ret = new Date(fx.date + "T00:00:00Z"); ret.setUTCDate(ret.getUTCDate() + 1);
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    const common = {
      name: fx.name, name_english: fx.name_english, type: "tx_event", date: fx.date, description: "",
      def_date_depart: iso(depart), def_date_return: iso(ret),
      map_image_url: ANFIELD_MAP, card_image_url: "", tags: "", is_test: true, is_deleted: null,
      skip_flight: true, ticket_only_markup: 200, tickets_and_rates: tickets, usual_price: 0,
    };
    const row = fx.mode === "lodging"
      ? {
          ...common,
          location: LONDON,
          event_location: LIVERPOOL,
          lodging_mode: "choice_split", lodging_default: "flight", split_default_nights: 2,
          lodging_note: "המשחק בליברפול. רכבת מלונדון כשעתיים ורבע, ההעברה אינה כלולה במחיר.",
          base_flight_price: 600, base_hotel_price: 480, package_mode: "package",
        }
      : {
          ...common,
          location: { ...LIVERPOOL, city_iata: "LON" },
          package_mode: "ticket_only", base_flight_price: 0, base_hotel_price: 0,
        };

    if (DRY) { console.log(fx.key, JSON.stringify({ ...row, tickets_and_rates: `${tickets.length} tickets` })); continue; }
    const { data, error } = await db.from("events").insert(row).select("id").single();
    if (error) throw error;
    console.log(`${fx.key}: created event ${data.id}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
