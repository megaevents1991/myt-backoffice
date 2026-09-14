// OUR package's contents - the airline, flight times, bag, hotel and board behind our base prices -
// for the /price-light side-by-side comparison (partner, 2026-09-14: "פירוט החבילה שלנו ושל המתחרה").
//
// `price-quote.ts` prices the rule and stores only the number; the light never edits the pricing
// code. So this re-runs the SAME rule read-only - the same Amadeus searches (`fetchFlightOffers`),
// the same direct-vs-connection pick (`pickFlightPrice`), the same 3★ hotel endpoint - and keeps the
// offer that rule would buy today. It describes; it never writes a price. Offline inventory linked
// to the event wins over the search, because that is what the customer actually gets.
//
// Stored under `events.light_detail.ours` (no migration; `recomputeEventLights` carries it over).
// Refreshed by the nightly rotation (`/api/cron/price-light-ours`) and on demand ("פרט עכשיו").
// Dor, 2026-09-14: the Amadeus/hotel calls are a paid service we already use - nightly and on
// demand are both fine.
import { supabase } from "@/lib/supabase-server";
import { fetchFlightOffers, getStopsCount, isUSADestination, type AmadeusOffer } from "@/lib/services/flight-search";
import { pickFlightPrice, QUOTE_HOTEL_ADULTS } from "@/lib/services/price-quote";
import { airlineFromCode, boardFrom } from "@/lib/services/offer-detail";
import type { LightDetail, OfferFlight, OfferHotel, OurOfferSnapshot } from "@/types/price-light.types";

// `events`/`flights`/`offline_hotels` columns used here predate the generated types in part -
// one boundary cast (repo pattern).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** A description older than this is refreshed by the nightly rotation. */
export const OUR_OFFER_REFRESH_DAYS = 7;
/** Events described in parallel - two Amadeus searches + one hotel search each. */
export const OUR_OFFER_CONCURRENCY = 3;
/** Wall-clock budget of one cron run (the function's maxDuration is 300s). */
export const OUR_OFFER_BUDGET_MS = 260_000;

export interface OurOfferEvent {
  id: number;
  location: { latitude?: number | null; longitude?: number | null; city_iata?: string | null } | null;
  def_date_depart: string | null;
  def_date_return: string | null;
  locked_flight_id?: number | null;
}

export const OUR_OFFER_EVENT_COLUMNS = "id,location,def_date_depart,def_date_return,locked_flight_id";

// ---- flight ---------------------------------------------------------------------------------
/** The parts of an Amadeus offer this file reads - narrower than the SDK's own untyped payload. */
interface DetailedOffer extends AmadeusOffer {
  validatingAirlineCodes?: string[];
  itineraries?: { segments?: { carrierCode?: string; departure?: { at?: string }; arrival?: { at?: string } }[] }[];
  travelerPricings?: { fareDetailsBySegment?: { includedCheckedBags?: { quantity?: number; weight?: number } }[] }[];
}

const hhmm = (iso: string | null | undefined): string | null => (iso && iso.length >= 16 ? iso.slice(11, 16) : null);
const price = (o: AmadeusOffer | null): number | null => {
  const n = Number.parseFloat(o?.price?.total ?? "");
  return Number.isFinite(n) ? n : null;
};
const cheapest = (offers: AmadeusOffer[]): AmadeusOffer | null =>
  offers.reduce<AmadeusOffer | null>((best, o) => {
    const p = price(o);
    if (p == null) return best;
    return best == null || p < (price(best) ?? Infinity) ? o : best;
  }, null);

/** "כולל מזוודה 23 ק"ג" / "ללא מזוודה" off the first segment's fare - null when Amadeus does not say. */
function bagOf(offer: DetailedOffer): string | null {
  const bags = offer.travelerPricings?.[0]?.fareDetailsBySegment?.[0]?.includedCheckedBags;
  if (!bags) return null;
  if ((bags.weight ?? 0) > 0) return `כולל מזוודה ${bags.weight} ק"ג`;
  if ((bags.quantity ?? 0) > 0) return "כולל מזוודה";
  return "ללא מזוודה";
}

function describeAmadeusOffer(offer: DetailedOffer): OfferFlight {
  const legs = offer.itineraries ?? [];
  const leg = (i: number) => {
    const segs = legs[i]?.segments ?? [];
    if (segs.length === 0) return null;
    return { depart: hhmm(segs[0].departure?.at), arrive: hhmm(segs[segs.length - 1].arrival?.at) };
  };
  return {
    airline: airlineFromCode(offer.validatingAirlineCodes?.[0] ?? legs[0]?.segments?.[0]?.carrierCode),
    direct: getStopsCount(offer) === 0,
    bag: bagOf(offer),
    out: leg(0),
    back: leg(1),
  };
}

/**
 * The flight `price-quote.ts` would price: cheapest direct, or the cheapest connection when the
 * direct beats it by more than $300 - with `searchCheapestOffer`'s own stop filter (1 connection,
 * 2 to the USA). Same two searches, so the chosen offer is the one behind the base price.
 */
async function describeRuleFlight(iata: string, depart: string, ret: string): Promise<OurOfferSnapshot["flight"]> {
  const [direct, any] = await Promise.all([
    fetchFlightOffers({ destinationLocationCode: iata, departureDate: depart, returnDate: ret, nonStop: true, max: 10 }),
    fetchFlightOffers({ destinationLocationCode: iata, departureDate: depart, returnDate: ret, nonStop: false, max: 50 }),
  ]);
  const maxStops = isUSADestination(iata) ? 2 : 1;
  const bestDirect = cheapest(direct);
  const bestAny = cheapest(any.filter((o) => getStopsCount(o) <= maxStops));
  const picked = pickFlightPrice(price(bestDirect), price(bestAny));
  if (!picked) return null;
  const offer = (picked.source === "direct" ? bestDirect : bestAny) as DetailedOffer;
  return { ...describeAmadeusOffer(offer), usd: Math.round(picked.raw), source: "amadeus" };
}

interface OfflineFlightRow {
  id: number; price: number | null; stops: number | null; airline_code: string | null; metadata_name: string | null;
  outbound_departure_time: string | null; outbound_arrival_time: string | null; outbound_check_bags_included: boolean | null;
  inbound_departure_time: string | null; inbound_arrival_time: string | null;
}

async function describeOfflineFlight(event: OurOfferEvent): Promise<OurOfferSnapshot["flight"] | undefined> {
  const cols = "id,price,stops,airline_code,metadata_name,outbound_departure_time,outbound_arrival_time,outbound_check_bags_included,inbound_departure_time,inbound_arrival_time";
  const query = event.locked_flight_id
    ? db.from("flights").select(cols).eq("id", event.locked_flight_id)
    : db.from("flights").select(cols).contains("event_ids", [event.id]).or("is_deleted.is.null,is_deleted.eq.false");
  const { data, error } = await query.order("price", { ascending: true }).limit(1);
  if (error) throw new Error(`offline flight read failed: ${error.message}`);
  const row = ((data ?? []) as OfflineFlightRow[])[0];
  if (!row) return undefined;
  return {
    airline: row.airline_code ? airlineFromCode(row.airline_code) : row.metadata_name,
    direct: (row.stops ?? 0) === 0,
    bag: row.outbound_check_bags_included == null ? null : row.outbound_check_bags_included ? "כולל מזוודה" : "ללא מזוודה",
    out: { depart: hhmm(row.outbound_departure_time), arrive: hhmm(row.outbound_arrival_time) },
    back: { depart: hhmm(row.inbound_departure_time), arrive: hhmm(row.inbound_arrival_time) },
    usd: row.price == null ? null : Math.round(Number(row.price)),
    source: "offline",
  };
}

// ---- hotel ----------------------------------------------------------------------------------
function boardOfMeal(meal: string | null | undefined): OfferHotel["board"] {
  const m = (meal ?? "").toLowerCase();
  if (!m) return null;
  if (m === "nomeal" || m.includes("room only")) return "room_only";
  if (/breakfast|board|inclusive/.test(m)) return "breakfast";
  return boardFrom(m);
}

/**
 * Main's hotel endpoint fans out to its rate supplier and fails under parallel load: the first full
 * pass (3 events at a time) lost 308 of 426 hotels to HTTP errors while every one of them answered
 * when asked alone. So hotel searches go through ONE queue, whatever the event concurrency, with
 * one retry on a 429/5xx.
 */
let hotelQueue: Promise<unknown> = Promise.resolve();
const HOTEL_RETRY_MS = 3_000;

function inHotelQueue<T>(task: () => Promise<T>): Promise<T> {
  const run = hotelQueue.then(task, task);
  hotelQueue = run.catch(() => undefined);
  return run;
}

/** Main's `/api/hotels` - the endpoint `quoteHotel` prices; it returns the hotel it picked too. */
async function describeRuleHotel(lat: number, lon: number, checkin: string, checkout: string): Promise<OurOfferSnapshot["hotel"]> {
  const base = process.env.NEXT_SECRET_HOTEL_SERVICE_URL || "http://localhost:3000";
  const secret = process.env.NEXT_SECRET_REVALIDATION_SECRET;
  // Same request shape as price-quote.ts quoteHotel (the secret-in-URL is its existing contract with
  // main - flagged in CLAUDE.md's security TODO, not widened here).
  const url = `${base}/api/hotels?lat=${lat}&lon=${lon}&checkin=${checkin}&checkout=${checkout}&secret=${secret}`;
  const call = () => fetch(url, { headers: { "Content-Type": "application/json" } });
  const response = await inHotelQueue(async () => {
    const first = await call();
    if (first.status !== 429 && first.status < 500) return first;
    await new Promise((r) => setTimeout(r, HOTEL_RETRY_MS));
    return call();
  });
  const data = (await response.json().catch(() => ({}))) as {
    cheapest_price?: number | null; message?: string;
    hotel?: { name?: string | null; room_name?: string | null; meal?: string | null };
  };
  if (!response.ok) throw new Error(`hotel search HTTP ${response.status}${data?.message ? `: ${data.message}` : ""}`);
  const room = Number(data?.cheapest_price);
  if (!Number.isFinite(room) || room <= 0 || !data.hotel) return null;
  return {
    name: data.hotel.name ?? null,
    stars: 3, // main's endpoint only ever returns 3★ (star_rating = 3) - that IS the rule
    board: boardOfMeal(data.hotel.meal),
    room: data.hotel.room_name ?? null,
    usd: Math.round(room / QUOTE_HOTEL_ADULTS),
    source: "hotel_api",
  };
}

interface OfflineHotelRow { id: number; hotel_name: string | null; price: number | null; room_type: string | null; meal_plan: string | null }

async function describeOfflineHotel(event: OurOfferEvent): Promise<OurOfferSnapshot["hotel"] | undefined> {
  const { data, error } = await db.from("offline_hotels")
    .select("id,hotel_name,price,room_type,meal_plan")
    .contains("event_ids", [event.id])
    .or("is_deleted.is.null,is_deleted.eq.false")
    .order("price", { ascending: true }).limit(1);
  if (error) throw new Error(`offline hotel read failed: ${error.message}`);
  const row = ((data ?? []) as OfflineHotelRow[])[0];
  if (!row) return undefined;
  return {
    name: row.hotel_name,
    stars: null,
    board: boardOfMeal(row.meal_plan),
    room: row.room_type,
    usd: row.price == null ? null : Math.round(Number(row.price) / QUOTE_HOTEL_ADULTS),
    source: "offline",
  };
}

// ---- the snapshot ---------------------------------------------------------------------------
const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e)).slice(0, 160);

/** Describe one event. Never throws - a half that fails is null with its reason in `errors`. */
export async function describeOurOffer(event: OurOfferEvent): Promise<OurOfferSnapshot> {
  const errors: string[] = [];
  const depart = event.def_date_depart?.slice(0, 10) ?? null;
  const ret = event.def_date_return?.slice(0, 10) ?? null;
  const iata = event.location?.city_iata ?? null;
  const lat = event.location?.latitude;
  const lon = event.location?.longitude;

  const flightTask = (async (): Promise<OurOfferSnapshot["flight"]> => {
    try {
      const offline = await describeOfflineFlight(event);
      if (offline !== undefined) return offline;
      if (!iata || !depart || !ret) { errors.push("flight: no city IATA or travel dates"); return null; }
      const found = await describeRuleFlight(iata, depart, ret);
      if (!found) errors.push("flight: no direct or connecting offer");
      return found;
    } catch (e) {
      errors.push(`flight: ${errText(e)}`);
      return null;
    }
  })();

  const hotelTask = (async (): Promise<OurOfferSnapshot["hotel"]> => {
    try {
      const offline = await describeOfflineHotel(event);
      if (offline !== undefined) return offline;
      if (typeof lat !== "number" || typeof lon !== "number" || !depart || !ret) {
        errors.push("hotel: no venue coordinates or travel dates");
        return null;
      }
      const found = await describeRuleHotel(lat, lon, depart, ret);
      if (!found) errors.push("hotel: no 3★ rate found");
      return found;
    } catch (e) {
      errors.push(`hotel: ${errText(e)}`);
      return null;
    }
  })();

  const [flight, hotel] = await Promise.all([flightTask, hotelTask]);
  return { at: new Date().toISOString(), flight, hotel, errors };
}

/**
 * Write `light_detail.ours`, keeping every other key. Read-then-write on one jsonb column: the only
 * other writer is `recomputeEventLights`, which carries `ours` over from what it read, so the worst a
 * race costs is one snapshot overwritten by its predecessor until the next refresh.
 */
export async function storeOurOffer(eventId: number, ours: OurOfferSnapshot): Promise<void> {
  const { data, error } = await db.from("events").select("light_detail").eq("id", eventId).maybeSingle();
  if (error) throw new Error(`our-offer: read light_detail ${eventId} failed: ${error.message}`);
  const detail: LightDetail = { ...((data?.light_detail as LightDetail | null) ?? {}), ours };
  const { error: writeError } = await db.from("events").update({ light_detail: detail }).eq("id", eventId);
  if (writeError) throw new Error(`our-offer: write light_detail ${eventId} failed: ${writeError.message}`);
}

export interface OurOfferPassSummary {
  candidates: number;
  described: number;
  fresh: number;
  withErrors: number;
  failedWrites: number;
  remaining: number;
  dryRun: boolean;
}

/**
 * Nightly rotation: every live, future event with a flight or hotel base whose description is
 * missing or older than OUR_OFFER_REFRESH_DAYS - never-described first, then oldest -
 * OUR_OFFER_CONCURRENCY at a time inside the budget. `dryRun` still searches (that is the thing
 * being tested) but writes nothing.
 */
export async function runOurOfferPass(opts: { dryRun: boolean; budgetMs?: number; limit?: number }): Promise<OurOfferPassSummary> {
  const start = Date.now();
  const budget = opts.budgetMs ?? OUR_OFFER_BUDGET_MS;
  const summary: OurOfferPassSummary = { candidates: 0, described: 0, fresh: 0, withErrors: 0, failedWrites: 0, remaining: 0, dryRun: opts.dryRun };
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await db.from("events")
    .select(`${OUR_OFFER_EVENT_COLUMNS},is_test,base_flight_price,base_hotel_price,ours_at:light_detail->ours->>at,ours_errors:light_detail->ours->errors`)
    .is("is_deleted", null)
    .gte("date", today)
    .order("date", { ascending: true })
    .limit(2000);
  if (error) {
    console.error("our-offer: candidate read failed", JSON.stringify(error));
    throw new Error(`our-offer candidates: ${error.message}`);
  }
  type Candidate = OurOfferEvent & {
    is_test?: boolean | null; base_flight_price: number | null; base_hotel_price: number | null;
    ours_at: string | null; ours_errors: string[] | null;
  };
  const staleBefore = new Date(Date.now() - OUR_OFFER_REFRESH_DAYS * 86_400_000).toISOString();
  const all = ((data ?? []) as Candidate[])
    .filter((e) => !e.is_test && ((Number(e.base_flight_price) || 0) > 0 || (Number(e.base_hotel_price) || 0) > 0));
  // A half lost to a passing failure (HTTP/API error, timeout) is retried the next night rather than
  // left blank for a week; a permanent answer ("no 3★ rate found", no dates) waits for the refresh.
  const transient = (e: Candidate) => (e.ours_errors ?? []).some((m) => /HTTP|API error|fetch failed|timeout|aborted/i.test(m));
  const due = all.filter((e) => !e.ours_at || e.ours_at < staleBefore || transient(e));
  summary.fresh = all.length - due.length;
  const queue = due.sort((a, b) => (a.ours_at ?? "").localeCompare(b.ours_at ?? "")).slice(0, opts.limit ?? due.length);
  summary.candidates = queue.length;

  let next = 0;
  const worker = async () => {
    while (next < queue.length && Date.now() - start < budget) {
      const event = queue[next++];
      const ours = await describeOurOffer(event);
      summary.described += 1;
      if (ours.errors.length > 0) summary.withErrors += 1;
      if (opts.dryRun) continue;
      try {
        await storeOurOffer(event.id, ours);
      } catch (e) {
        summary.failedWrites += 1;
        console.error(`our-offer: store ${event.id} failed`, e);
      }
    }
  };
  await Promise.all(Array.from({ length: OUR_OFFER_CONCURRENCY }, worker));
  summary.remaining = queue.length - summary.described;
  return summary;
}
