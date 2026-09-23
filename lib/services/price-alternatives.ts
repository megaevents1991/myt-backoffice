// What ELSE we could sell for a red event - the data half of the price advisor's two newer facts
// (staff doc note 6, 2026-09-18: "שינוי ימי האירוע ... החלפת ספק כרטיסים"):
//
//   1. other TRAVEL DAYS around the same event date - the pricing rule's own flight search
//      (`describeRuleFlight`: cheapest direct, or the connection past the $300 gap) run on a few
//      neighbouring windows, together with the baseline so a saving compares two prices quoted in
//      the same minute;
//   2. other TICKET SUPPLIERS for the same event - LiveTickets and TixStock (both can be attached
//      to an event today, "Suppliers & zones") and XS2Event (catalog price only - information).
//
// It quotes and stores; it decides nothing and never writes a price. The arithmetic and the Hebrew
// sentences are lib/services/price-advice.ts (pure). Stored under `light_detail.ours.alt` - inside
// `ours` on purpose, because every writer of `light_detail` already carries `ours` over whole.
// Dor, 2026-09-18: Amadeus is our own paid environment - sample it whenever we like.
import { supabase } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";
import { describeRuleFlight } from "@/lib/services/our-offer-detail";
import { altDateCandidates } from "@/lib/services/price-advice";
import { minAvailableTicketUsd, pickRuleMatch, type MatchCandidate } from "@/lib/services/price-light";
import { loadEventForLight, type LightEvent } from "@/lib/services/price-light-store";
import { currencyFromCode, liveTicketsPriceUsd, toLiveTicketsCategory, type RawLiveTicketsCategory } from "@/lib/services/livetickets-offers";
import { multiCurrencyExchangeRateService } from "@/lib/services/ticket-price-sync";
import { fetchTixStockFeed } from "@/lib/services/tixstock-price-sync";
import { supplierPriceUsd, ticketSupplier, type SupplierCurrency, type TicketSupplier } from "@/lib/suppliers";
import type { EventTicket, EventType } from "@/types/app.types";
import type { AltDateQuote, AltSupplierQuote, LightDetail, OurAlternatives } from "@/types/price-light.types";

// Several of these tables predate the generated DB types - one boundary cast (repo pattern).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Alternatives older than this are quoted again - flight prices move faster than package contents. */
export const ALT_REFRESH_DAYS = 3;
/** Red events quoted side by side. Each is up to six flight searches and three supplier reads. */
export const ALT_CONCURRENCY = 2;
const ALT_EVENTS_MAX = 5_000;
const DAY_MS = 86_400_000;

const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e)).slice(0, 160);
const dayOf = (iso: string | null | undefined): string | null => (iso ? iso.slice(0, 10) : null);
const shiftDay = (day: string, delta: number): string => new Date(Date.parse(`${day}T00:00:00.000Z`) + delta * DAY_MS).toISOString().slice(0, 10);
const nightsOf = (depart: string, ret: string): number => Math.round((Date.parse(`${ret}T00:00:00.000Z`) - Date.parse(`${depart}T00:00:00.000Z`)) / DAY_MS);
const toUsd = (amount: number, currency: SupplierCurrency): number =>
  currency === "USD" ? amount : multiCurrencyExchangeRateService.convertToUSD(amount, currency);

// ---- travel days ------------------------------------------------------------------------------
async function quoteWindow(iata: string, depart: string, ret: string): Promise<AltDateQuote | null> {
  const flight = await describeRuleFlight(iata, depart, ret);
  if (!flight || flight.usd == null) return null;
  return { depart, return: ret, nights: nightsOf(depart, ret), flight_usd: flight.usd, airline: flight.airline, direct: flight.direct };
}

/**
 * The baseline and its neighbours. Skipped - with the reason recorded - when the flight is not the
 * rule's to move: an offline flight is inventory we already hold for fixed days.
 */
async function quoteDates(event: LightEvent, errors: string[]): Promise<{ base: AltDateQuote | null; dates: AltDateQuote[] }> {
  const none = { base: null, dates: [] };
  const depart = dayOf(event.def_date_depart);
  const ret = dayOf(event.def_date_return);
  const iata = event.location?.city_iata ?? null;
  // `skip_flight` is NOT a reason to stop: it is true on almost every live event (428 of 436 on
  // 2026-09-11) and the package light compares a flight regardless (price-light.ts, same date).
  if (!depart || !ret || !iata) { errors.push("dates: no city IATA or travel dates"); return none; }
  if (event.light_detail?.ours?.flight?.source === "offline") { errors.push("dates: the flight is offline inventory (fixed days)"); return none; }
  const windows = altDateCandidates(event.date.slice(0, 10), depart, ret, new Date().toISOString().slice(0, 10));
  if (windows.length === 0) return none;
  // Baseline and neighbours side by side: a handful of searches against our own paid Amadeus
  // environment, and "פרט את שלנו עכשיו" waits on them with a person watching.
  const [baseRes, ...altRes] = await Promise.allSettled([
    quoteWindow(iata, depart, ret),
    ...windows.map((w) => quoteWindow(iata, w.depart, w.return)),
  ]);
  if (baseRes.status === "rejected") errors.push(`dates: baseline ${errText(baseRes.reason)}`);
  const base = baseRes.status === "fulfilled" ? baseRes.value : null;
  // No baseline, nothing to measure a saving from - the neighbours would be numbers without a meaning.
  if (!base) { if (baseRes.status === "fulfilled") errors.push("dates: no flight offer on the current days"); return none; }
  const dates: AltDateQuote[] = [];
  altRes.forEach((res, i) => {
    if (res.status === "fulfilled") { if (res.value) dates.push(res.value); }
    else errors.push(`dates: ${windows[i].depart}..${windows[i].return} ${errText(res.reason)}`);
  });
  return { base, dates };
}

// ---- suppliers --------------------------------------------------------------------------------
const namesOf = (event: LightEvent): string[] => [event.name, event.name_english ?? ""].filter(Boolean);

/** The light's own rule matcher over a supplier's catalog rows - the same bar a competitor listing has to pass. */
function pickByName<T extends { title: string; day: string }>(event: LightEvent, rows: T[]): T | null {
  const candidates = rows.map<MatchCandidate>((r, i) => ({ id: i, title: r.title, event_date: r.day }));
  const hit = pickRuleMatch({ names: namesOf(event), date: event.date.slice(0, 10) }, candidates);
  return hit ? rows[hit.candidate.id] : null;
}

/** LiveTickets: already paired with this event by the ticket light - its cheapest category WE would sell. */
async function liveTicketsQuote(event: LightEvent): Promise<AltSupplierQuote | null> {
  const { data: match, error: matchError } = await db.from("competitor_matches").select("listing_id,status")
    .eq("event_id", event.id).eq("competitor", "livetickets").eq("scope", "ticket")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (matchError) throw new Error(`livetickets match: ${matchError.message}`);
  if (!match || match.status !== "found" || match.listing_id == null) return null;
  const { data: listing, error: listingError } = await db.from("competitor_listings").select("external_key").eq("id", match.listing_id).maybeSingle();
  if (listingError) throw new Error(`livetickets listing: ${listingError.message}`);
  const liveEventId = Number(listing?.external_key);
  if (!Number.isInteger(liveEventId)) return null;
  const { data: live, error: liveError } = await db.from("live_events").select("event_id,currency,ticket_categories").eq("event_id", liveEventId).maybeSingle();
  if (liveError) throw new Error(`live_events: ${liveError.message}`);
  const currency = currencyFromCode(Number(live?.currency));
  if (!live || !currency) return null;
  // Only what the attach flow would accept (instant confirm, pairs, 2+ per order) - advising a
  // category we refuse to sell is advising nothing.
  const sellable = ((live.ticket_categories ?? []) as RawLiveTicketsCategory[])
    .map(toLiveTicketsCategory).filter((c) => c.sellable && c.maxPerOrder >= 2 && c.cost > 0).sort((a, b) => a.cost - b.cost);
  const cheapest = sellable[0];
  if (!cheapest) return null;
  return {
    supplier: "livetickets", category: cheapest.hebTitle || cheapest.title || null, cost: cheapest.cost, currency,
    sell_usd: liveTicketsPriceUsd(cheapest.cost, currency), attachable: true, ref: String(liveEventId),
  };
}

/** XS2Event: catalog "from" price. Not attachable as a second supplier today - information only. */
async function xs2Quote(event: LightEvent): Promise<AltSupplierQuote | null> {
  const day = event.date.slice(0, 10);
  const { data, error } = await db.from("xs2e_events")
    .select("event_id,event_name,date_start,min_ticket_price_eur,number_of_tickets")
    .gte("date_start", `${shiftDay(day, -1)}T00:00:00Z`).lte("date_start", `${shiftDay(day, 1)}T23:59:59Z`)
    .gt("number_of_tickets", 0).not("min_ticket_price_eur", "is", null).limit(1000);
  if (error) throw new Error(`xs2e_events: ${error.message}`);
  type Row = { event_id: string; event_name: string; date_start: string; min_ticket_price_eur: number };
  const hit = pickByName(event, ((data ?? []) as Row[]).map((r) => ({ ...r, title: r.event_name, day: r.date_start.slice(0, 10) })));
  const cost = Number(hit?.min_ticket_price_eur);
  if (!hit || !Number.isFinite(cost) || cost <= 0) return null;
  return { supplier: "xs2event", category: null, cost, currency: "EUR", sell_usd: supplierPriceUsd(cost, "EUR", toUsd), attachable: false, ref: hit.event_id };
}

/** TixStock: their catalog has no prices, so the matched event's live feed is read (pairs only, like the price sync). */
async function tixstockQuote(event: LightEvent): Promise<AltSupplierQuote | null> {
  const day = event.date.slice(0, 10);
  const { data, error } = await db.from("tixstock_events").select("event_id,event_name,show_date")
    .gte("show_date", `${shiftDay(day, -1)}T00:00:00Z`).lte("show_date", `${shiftDay(day, 1)}T23:59:59Z`).limit(1000);
  if (error) throw new Error(`tixstock_events: ${error.message}`);
  type Row = { event_id: string; event_name: string; show_date: string };
  const hit = pickByName(event, ((data ?? []) as Row[]).map((r) => ({ ...r, title: r.event_name, day: r.show_date.slice(0, 10) })));
  if (!hit) return null;
  let best: { cost: number; currency: SupplierCurrency; category: string | null } | null = null;
  for (const t of await fetchTixStockFeed(hit.event_id)) {
    const cost = Number.parseFloat(t.proceed_price?.amount ?? "");
    const currency = (t.proceed_price?.currency ?? t.face_value?.currency ?? "GBP").toUpperCase();
    if (!Number.isFinite(cost) || cost <= 0 || (t.number_of_tickets_for_sale?.quantity_available ?? 0) < 2) continue;
    if (currency !== "USD" && currency !== "EUR" && currency !== "GBP" && currency !== "ILS") continue;
    if (!best || toUsd(cost, currency) < toUsd(best.cost, best.currency)) best = { cost, currency, category: t.seat_details?.category ?? null };
  }
  if (!best) return null;
  return { supplier: "tixstock", ...best, sell_usd: supplierPriceUsd(best.cost, best.currency, toUsd), attachable: true, ref: hit.event_id };
}

/** Every supplier the event does NOT already buy from. One failing supplier never costs the others. */
async function quoteSuppliers(event: LightEvent, errors: string[]): Promise<AltSupplierQuote[]> {
  if (minAvailableTicketUsd(event) == null) return [];
  const used = new Set<TicketSupplier>(
    ((event.tickets_and_rates ?? []) as unknown as EventTicket[]).map((t) => ticketSupplier(t, event.type as EventType)),
  );
  const sources: { supplier: AltSupplierQuote["supplier"]; skip: boolean; run: () => Promise<AltSupplierQuote | null> }[] = [
    { supplier: "livetickets", skip: used.has("livetickets"), run: () => liveTicketsQuote(event) },
    { supplier: "tixstock", skip: used.has("tixstock"), run: () => tixstockQuote(event) },
    // XS2 tickets live on the legacy sports types, which carry no per-ticket supplier.
    { supplier: "xs2event", skip: event.type === "sports_event" || event.type === "sports_event_dynamic", run: () => xs2Quote(event) },
  ];
  const out: AltSupplierQuote[] = [];
  for (const source of sources) {
    if (source.skip) continue;
    try {
      const quote = await source.run();
      if (quote) out.push(quote);
    } catch (e) {
      errors.push(`${source.supplier}: ${errText(e)}`);
    }
  }
  return out;
}

// ---- store ------------------------------------------------------------------------------------
/** Quote one event. Never throws - what failed is in `errors`, what answered is kept. */
export async function quoteAlternatives(event: LightEvent): Promise<OurAlternatives> {
  const errors: string[] = [];
  // Travel days are a PACKAGE question: 225 of the 242 red events on 2026-09-18 were red on the
  // ticket alone, and six flight searches each would have spent the run on advice nobody reads.
  const wantsDates = event.light_package === "red";
  const [{ base, dates }, suppliers] = await Promise.all([
    wantsDates ? quoteDates(event, errors) : Promise.resolve({ base: null, dates: [] as AltDateQuote[] }),
    quoteSuppliers(event, errors),
  ]);
  return { at: new Date().toISOString(), base, dates, suppliers, errors };
}

/** Read-modify-write of `light_detail.ours.alt` only - the description beside it is left as found. */
async function storeAlternatives(eventId: number, alt: OurAlternatives): Promise<void> {
  const { data, error } = await db.from("events").select("light_detail").eq("id", eventId).maybeSingle();
  if (error) throw new Error(`alternatives: read light_detail ${eventId} failed: ${error.message}`);
  const detail = ((data?.light_detail as LightDetail | null) ?? {}) as LightDetail;
  const ours = detail.ours ?? { at: alt.at, flight: null, hotel: null, errors: ["not described yet"] };
  const { error: writeError } = await db.from("events").update({ light_detail: { ...detail, ours: { ...ours, alt } } }).eq("id", eventId);
  if (writeError) throw new Error(`alternatives: write light_detail ${eventId} failed: ${writeError.message}`);
}

/** On demand ("פרט את שלנו עכשיו" on a red event): quote and store one event. Null = not found. */
export async function refreshAlternatives(eventId: number): Promise<OurAlternatives | null> {
  const event = await loadEventForLight(eventId);
  if (!event || event.is_deleted) return null;
  await multiCurrencyExchangeRateService.updateAllExchangeRates().catch((e) => console.warn("alternatives: rates not refreshed", e));
  const alt = await quoteAlternatives(event);
  await storeAlternatives(eventId, alt);
  return alt;
}

export interface AlternativesPassSummary { candidates: number; quoted: number; withErrors: number; failedWrites: number; remaining: number; dryRun: boolean }

/**
 * The nightly pass: live future events with a RED light on either scope whose alternatives are
 * missing or older than ALT_REFRESH_DAYS - never-quoted first, then oldest - inside the budget the
 * caller has left. A `dryRun` still searches (that is what is being tested) and writes nothing.
 */
export async function runAlternativesPass(opts: { dryRun: boolean; budgetMs: number; limit?: number }): Promise<AlternativesPassSummary> {
  const start = Date.now();
  const summary: AlternativesPassSummary = { candidates: 0, quoted: 0, withErrors: 0, failedWrites: 0, remaining: 0, dryRun: opts.dryRun };
  if (opts.budgetMs <= 0) return summary;
  const today = new Date().toISOString().slice(0, 10);
  type Candidate = { id: number; is_test: boolean | null; alt_at: string | null };
  const { rows, error, truncated } = await fetchPaged<Candidate>(
    () => db.from("events").select("id,is_test,alt_at:light_detail->ours->alt->>at")
      .is("is_deleted", null).gte("date", today).or("light_package.eq.red,light_ticket.eq.red").order("id", { ascending: true }),
    ALT_EVENTS_MAX,
  );
  if (error) { console.error("alternatives: candidate read failed", JSON.stringify(error)); throw new Error(`alternatives candidates: ${error.message}`); }
  if (truncated) console.error(`alternatives: candidate read truncated at ${ALT_EVENTS_MAX}`);
  const staleBefore = new Date(Date.now() - ALT_REFRESH_DAYS * DAY_MS).toISOString();
  const queue = rows.filter((e) => !e.is_test && (!e.alt_at || e.alt_at < staleBefore))
    .sort((a, b) => (a.alt_at ?? "").localeCompare(b.alt_at ?? "")).slice(0, opts.limit ?? rows.length);
  summary.candidates = queue.length;
  if (queue.length === 0) return summary;
  await multiCurrencyExchangeRateService.updateAllExchangeRates().catch((e) => console.warn("alternatives: rates not refreshed", e));

  let next = 0;
  const worker = async () => {
    while (next < queue.length && Date.now() - start < opts.budgetMs) {
      const { id } = queue[next++];
      try {
        const event = await loadEventForLight(id);
        if (!event || event.is_deleted) continue;
        const alt = await quoteAlternatives(event);
        summary.quoted += 1;
        if (alt.errors.length > 0) summary.withErrors += 1;
        if (!opts.dryRun) await storeAlternatives(id, alt);
      } catch (e) {
        summary.failedWrites += 1;
        console.error(`alternatives: event ${id} failed`, e);
      }
    }
  };
  await Promise.all(Array.from({ length: ALT_CONCURRENCY }, worker));
  summary.remaining = Math.max(0, queue.length - next);
  return summary;
}
