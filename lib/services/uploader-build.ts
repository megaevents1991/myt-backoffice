/**
 * Tour uploader (agent #3) - build ONE show into one HIDDEN event. Spec:
 * docs/superpowers/specs/2026-10-21-tour-uploader-agent-design.md section 9.
 *
 * Order matters - the cheapest checks first, the paid searches last:
 *   1. tickets   - TixStock's feed and LiveTickets' stock through the pure `lib/uploader/tickets.ts`
 *                  (retry once; LiveTickets then falls back to our `live_events` snapshot). Zero
 *                  tickets = `skipped no_tickets`; zero because a supplier never answered = `error`
 *                  (never read a silence as "sells nothing").
 *   2. location  - the reads (locations, the venue memory STRICT, LiveTickets' city, an earlier
 *                  answer) and the pure decision tree `decidePlace` (lib/uploader/place.ts): two-city
 *                  chosen -> the item's answer -> no-coordinates path -> nearest location -> memory
 *                  two-city -> the plan's `without_location` rule. Never a guessed flight city.
 *   3. duplicate - names first, then `existingEventFor` again with the located IATA, under both the
 *                  convention name (music: "Eric Clapton") and the supplier's title.
 *   4. map       - the venue template (`venue_maps`) zones the tickets, else the supplier drawing.
 *   5. dates     - `calculateSmartDates`.
 *   6. bases     - package only: `quoteFlight` / `quoteHotel` of the location (the ONE pricing rule),
 *                  retry once; still nothing = the `no_base_price` BLOCKER (the event is still built).
 *                  A ticket-only build whose plan has no ticket-only markup = the `no_ticket_only_markup`
 *                  BLOCKER (built hidden with `ticket_only_markup: null`; approval waits for the editor).
 *   7. `createEvent` (hidden) - and the item row gets the `event_id` AT ONCE (an action cut off
 *      mid-build never leaves a hidden event no item points at), 8. decisions + warnings + blockers,
 *      audit `uploader.built`.
 *
 * No price is computed here: tickets are priced by the sync's own functions
 * (`tixstockTicketPriceUsd`, `liveTicketsPriceUsd`), bases by `price-quote.ts`.
 *
 * `buildItem` never throws: anything that goes wrong is `{ status: "error", item: { error } }`.
 * It calls `createEvent`, which guards with `requireStaff()` - so it runs inside a server action
 * (Task 8), never from a script. Modules that need the supplier env at load (the exchange-rate
 * service, the TixStock / LiveTickets clients, the event actions) are imported inside the call,
 * so a missing env is an item error, not a crash of whoever imports this file.
 */
import { logAudit } from "@/lib/audit";
import { loadLocations } from "@/lib/services/nearest-location";
import { quoteFlight, quoteHotel, type QuoteResult } from "@/lib/services/price-quote";
import { loadPriorItems, venueMapFor } from "@/lib/services/uploader-prior";
import { existingForShow } from "@/lib/services/uploader-search";
import { findVenueMemory } from "@/lib/services/venue-memory";
import { calculateSmartDates } from "@/lib/smart-dates";
import { supabase, supabaseTyped } from "@/lib/supabase-server";
import { decision } from "@/lib/uploader/decisions";
import { eventNames, withSupplierSpellings } from "@/lib/uploader/names";
import { decidePlace, type PlaceInput } from "@/lib/uploader/place";
import { existingEventFor, priorAnswerFor, questionKey, type Subject } from "@/lib/uploader/shows";
import { ticketsFromLiveStock, ticketsFromTixStockFeed, type TixDropReason } from "@/lib/uploader/tickets";
import { WARNING_TEXT, warningsFor, type BuildFacts, type SubjectRows } from "@/lib/uploader/warnings";
import { zoneFromTemplate } from "@/lib/venue-maps/zone-from-template";
import type { LiveTicketsStock, RawLiveTicketsCategory } from "@/lib/services/livetickets-offers";
import type { Event, EventTicket } from "@/types/app.types";
import type { Json } from "@/types/database.types";
import type { Decision, ShowIdentity, UploaderItem, UploaderQuestion, UploaderRun, Warning } from "@/types/uploader.types";

// `uploader_items` is newer than types/database.types.ts - one boundary cast for the event_id write.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type BuildResult = { status: "ready" | "skipped" | "question" | "error"; item: Partial<UploaderItem> };

export type BuildContext = {
  subject: Subject;
  rows: SubjectRows;
  teamsHe: Record<string, string>;
  /** The far-venue offer was clicked: rebuild as a package flying to this `locations` row, lodging split with the venue city. */
  twoCity?: { flightCityId: number };
};

type Supplier = "tixstock" | "livetickets";

/** How the decision line names a TixStock category the site rules dropped. */
const TIX_DROP_LABEL: Record<TixDropReason, string> = {
  restricted: "restricted view",
  split: "שהמוכר לא מוכר בזוג",
  excluded: "בלי מחיר",
};

/** Columns of the created row that other jobs rewrite on their own (lights, creatives, ready package, price drop, timestamps). */
const VOLATILE_COLUMN = /^(light_|campaign_|ready_package_|price_drop_)|^(created_at|updated_at)$/;

/** "2027-05-20" -> "20.05" (the decision line). */
const dayMonth = (day: string): string => day.split("-").reverse().slice(0, 2).join(".");

// ---- results -------------------------------------------------------------------------------------

const skipped = (
  show: ShowIdentity,
  reason: string,
  decisions: Decision[],
  warnings: Warning[] = [],
  location: UploaderItem["location"] = null,
): BuildResult => ({
  status: "skipped",
  item: { status: "skipped", show, skip_reason: reason, decisions, warnings, location },
});

// ---- tickets -------------------------------------------------------------------------------------

/** The call, and once more if it threw or answered null. null = no answer after the retry. */
async function twice<T>(call: () => Promise<T | null>): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await call();
      if (out !== null) return out;
    } catch (e) {
      console.warn("uploader-build: supplier call failed", e instanceof Error ? e.message : String(e));
    }
  }
  return null;
}

/** Counts per reason as decision lines ("2 קטגוריות restricted view הושמטו"). */
function droppedLines(dropped: { label: string }[]): Decision[] {
  const counts = new Map<string, number>();
  for (const d of dropped) counts.set(d.label, (counts.get(d.label) ?? 0) + 1);
  return [...counts].map(([reason, count]) => decision("categories_dropped", { count, reason }));
}

/** TixStock: the show's feed -> one ticket per sellable category. `reached: false` = no answer after a retry. */
async function tixstockTickets(eventId: string): Promise<{ tickets: EventTicket[]; decisions: Decision[]; reached: boolean }> {
  const { fetchTixStockFeed, tixstockTicketPriceUsd } = await import("@/lib/services/tixstock-price-sync");
  const listings = await twice(() => fetchTixStockFeed(eventId));
  if (listings === null) return { tickets: [], decisions: [], reached: false };
  const out = ticketsFromTixStockFeed(listings, eventId, tixstockTicketPriceUsd, () => crypto.randomUUID());
  const decisions: Decision[] = [];
  if (out.tickets.length > 0) decisions.push(decision("tickets_tixstock", { count: out.tickets.length }));
  // A listing with no category at all arrives as category "" - noise, not a category to name.
  decisions.push(...droppedLines(out.dropped.filter((d) => d.category !== "").map((d) => ({ label: TIX_DROP_LABEL[d.reason] }))));
  return { tickets: out.tickets, decisions, reached: true };
}

/**
 * LiveTickets: their live stock, once more on no answer, then our `live_events` snapshot (the
 * `buildLiveTicketsDrafts` fallback) - SELLABLE categories only; the rest are named in a decision
 * line. Prices taken from the snapshot say so (`live_from_snapshot`). `reached: false` = the API did
 * not answer AND the snapshot sells nothing (a snapshot's categories are usually blocked - that is
 * an outage, not "LiveTickets has no tickets"). A failed snapshot READ throws.
 */
async function liveTickets(eventId: number): Promise<{ tickets: EventTicket[]; decisions: Decision[]; reached: boolean }> {
  const offers = await import("@/lib/services/livetickets-offers");
  const eid = String(eventId);
  let stock: LiveTicketsStock | "SOLD_OUT" | null = await twice(() => offers.fetchLiveTicketsStock(eid));
  let fromSnapshot = false;
  if (stock === null) {
    const { data, error } = await supabaseTyped.from("live_events").select("currency,ticket_categories").eq("event_id", eventId).maybeSingle();
    if (error) {
      console.error("uploader-build: live_events snapshot read failed", JSON.stringify(error));
      throw new Error(`live_events snapshot read failed: ${error.message}`);
    }
    const currency = data ? offers.currencyFromCode(data.currency) : null;
    if (data && currency) {
      const raw = Array.isArray(data.ticket_categories) ? data.ticket_categories : [];
      // The snapshot is LiveTickets' own category shape - a jsonb boundary.
      stock = { currency, categories: (raw as unknown as RawLiveTicketsCategory[]).map(offers.toLiveTicketsCategory) };
      fromSnapshot = true;
    }
  }
  const out = ticketsFromLiveStock(stock, eid, offers.liveTicketsPriceUsd);
  if (out.state === "unreachable" || (fromSnapshot && out.tickets.length === 0)) return { tickets: [], decisions: [], reached: false };
  const decisions: Decision[] = [];
  if (out.tickets.length > 0) decisions.push(decision("tickets_livetickets", { count: out.tickets.length }));
  if (fromSnapshot) decisions.push(decision("live_from_snapshot", { count: out.tickets.length }));
  decisions.push(
    ...droppedLines(
      out.dropped.map((d) => ({ label: d.reason === offers.NOT_INSTANT_REASON ? "של LiveTickets שאינן באישור מיידי" : `של LiveTickets (${d.reason})` })),
    ),
  );
  return { tickets: out.tickets, decisions, reached: true };
}

// ---- answers -------------------------------------------------------------------------------------

/** A jsonb value as an object, or null. */
const jsonObject = (v: Json | null): { [key: string]: Json | undefined } | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? v : null;

/**
 * A search question answered by a person (or by a prior answer) changes WHICH listing the show is:
 * `pick_show` names a TixStock event id or `live:<id>`, `pick_date` names the day. "both" and
 * "skip" are not handled here (the caller splits / the build skips). Idempotent - applying the same
 * answer to an already-applied show changes nothing.
 */
async function applyShowAnswer(show: ShowIdentity, q: UploaderQuestion | null): Promise<ShowIdentity> {
  const key = q?.answer?.key ?? null;
  if (!q || key === null || key === "both" || key === "skip") return show;
  if (q.kind === "pick_date") {
    const day = /^(tix|live):(\d{4}-\d{2}-\d{2})$/.exec(key)?.[2];
    return day ? { ...show, date: day } : show;
  }
  if (q.kind !== "pick_show") return show;

  const liveId = /^live:(\d+)$/.exec(key)?.[1];
  if (liveId) {
    const { data, error } = await supabaseTyped
      .from("live_events")
      .select("event_id,event_name,event_name_heb,show_date,city_name,ticket_categories")
      .eq("event_id", Number(liveId))
      .maybeSingle();
    if (error) {
      console.error("uploader-build: live_events (answer) read failed", JSON.stringify(error));
      throw new Error(`live_events read failed: ${error.message}`);
    }
    if (!data) throw new Error(`the answer names LiveTickets event ${liveId}, which is not in live_events`);
    const { toLiveTicketsCategory } = await import("@/lib/services/livetickets-offers");
    const raw = Array.isArray(data.ticket_categories) ? data.ticket_categories : [];
    const sellable = (raw as unknown as RawLiveTicketsCategory[]).map(toLiveTicketsCategory).filter((c) => c.sellable).length;
    const liveOnly = show.suppliers.tixstock === null;
    return {
      ...show,
      ...(liveOnly ? { name_english: data.event_name, city: (data.city_name ?? show.city).trim(), date: data.show_date.trim().slice(0, 10) } : {}),
      suppliers: { ...show.suppliers, livetickets: { event_id: data.event_id, name_heb: data.event_name_heb, sellable } },
    };
  }

  const { data, error } = await supabaseTyped
    .from("tixstock_events")
    .select("event_id,event_name,show_date,venue_name,city_name,country_code,ticket_count,venue_map_url,venue_data")
    .eq("event_id", key)
    .maybeSingle();
  if (error) {
    console.error("uploader-build: tixstock_events (answer) read failed", JSON.stringify(error));
    throw new Error(`tixstock_events read failed: ${error.message}`);
  }
  if (!data) throw new Error(`the answer names TixStock event ${key}, which is not in tixstock_events`);
  const venue = jsonObject(data.venue_data);
  const coord = (k: "latitude" | "longitude"): number | null => {
    const v = venue?.[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  return {
    ...show,
    name_english: data.event_name,
    city: (data.city_name ?? show.city).trim(),
    country_code: data.country_code,
    venue: data.venue_name,
    date: data.show_date.trim().slice(0, 10),
    lat: coord("latitude"),
    lon: coord("longitude"),
    suppliers: {
      ...show.suppliers,
      tixstock: { event_id: data.event_id, name: data.event_name, ticket_count: data.ticket_count, venue_map_url: data.venue_map_url },
    },
  };
}

// ---- location reads (the decision itself is the pure `decidePlace`, lib/uploader/place.ts) -------

/** A jsonb value's `city_iata`, or null. */
function cityIataOf(v: Json | null): string | null {
  const iata = jsonObject(v)?.city_iata;
  return typeof iata === "string" && iata.trim() !== "" ? iata.trim() : null;
}

/** `live_events.iata` / `city_name` of the show's LiveTickets row (`decidePlace` matches them to `locations`). */
async function readLiveCity(liveEventId: number): Promise<{ iata: string | null; city: string | null }> {
  const { data, error } = await supabaseTyped.from("live_events").select("iata,city_name").eq("event_id", liveEventId).maybeSingle();
  if (error) {
    console.error("uploader-build: live_events (location) read failed", JSON.stringify(error));
    throw new Error(`live_events read failed: ${error.message}`);
  }
  return { iata: data?.iata ?? null, city: data?.city_name ?? null };
}

/**
 * The venue's memory, STRICT (a failed read throws - an unreadable memory must not turn a known
 * two-city venue into ticket-only): the remembered event, its lodging, and - when the lodging names
 * a second city - the IATA of the city that event flew to.
 */
async function readMemory(show: ShowIdentity): Promise<PlaceInput["memory"]> {
  const tix = show.suppliers.tixstock;
  if (!tix?.venue_map_url) return null;
  const memory = await findVenueMemory(
    { mapUrl: tix.venue_map_url, eventType: "tx_event", supplierEventId: tix.event_id, supplierVenueName: show.venue },
    { strict: true },
  );
  if (!memory) return null;
  let flightIata: string | null = null;
  if (memory.lodging?.event_location) {
    const { data, error } = await supabaseTyped.from("events").select("location").eq("id", memory.fromEventId).maybeSingle();
    if (error) {
      console.error("uploader-build: memory event read failed", JSON.stringify(error));
      throw new Error(`events (memory) read failed: ${error.message}`);
    }
    flightIata = cityIataOf(data?.location ?? null);
  }
  return { fromEventName: memory.fromEventName, lodging: memory.lodging, flightIata };
}

/**
 * Everything `decidePlace` needs, read once: the `locations` table, the venue's memory, and - only
 * for a show without venue coordinates - LiveTickets' city fields and an earlier run's answer.
 */
async function readPlaceInput(run: UploaderRun, item: UploaderItem, show: ShowIdentity, ctx: BuildContext): Promise<PlaceInput> {
  const noCoords = typeof show.lat !== "number" || typeof show.lon !== "number";
  const answer = item.question?.kind === "pick_location" ? (item.question.answer ?? null) : null;
  const [rows, memory] = await Promise.all([loadLocations(), readMemory(show)]);
  let liveCity: PlaceInput["liveCity"] = null;
  let prior: PlaceInput["prior"] = null;
  if (noCoords && !answer && !ctx.twoCity) {
    const liveRef = show.suppliers.livetickets;
    const [city, priors] = await Promise.all([liveRef ? readLiveCity(liveRef.event_id) : null, loadPriorItems(ctx.subject.name_en)]);
    liveCity = city;
    const hit = priorAnswerFor({ subject_en: ctx.subject.name_en, kind: "pick_location", key: questionKey(show, ctx.subject.name_en) }, priors);
    prior = hit?.answer ? { key: hit.answer.key, text: hit.answer.text, by: hit.by, run_no: hit.run_no } : null;
  }
  return {
    show,
    subject_en: ctx.subject.name_en,
    rows,
    withoutLocation: run.plan.rules.without_location,
    twoCity: ctx.twoCity ?? null,
    answer: answer ? { key: answer.key, text: answer.text } : null,
    prior,
    liveCity,
    memory,
    now: new Date(),
  };
}

// ---- bases ---------------------------------------------------------------------------------------

/** One quote, once more on a null or a throw. null = no base after the retry. */
async function quoteTwice(call: () => Promise<QuoteResult>): Promise<number | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const q = await call();
      if (q && Number.isFinite(q.price) && q.price > 0) return q.price;
    } catch (e) {
      console.warn("uploader-build: quote failed", e instanceof Error ? e.message : String(e));
    }
  }
  return null;
}

// ---- build ---------------------------------------------------------------------------------------

/** Decisions the SEARCH puts on an item before it is built (a prior answer applied) - a build keeps them. */
const SEARCH_DECISIONS = new Set(["prior_answer"]);

function pushUnique(list: Decision[], more: Decision[]): void {
  for (const d of more) if (!list.some((x) => x.code === d.code && x.text === d.text)) list.push(d);
}

async function build(run: UploaderRun, item: UploaderItem, ctx: BuildContext): Promise<BuildResult> {
  const decisions: Decision[] = (item.decisions ?? []).filter((d) => SEARCH_DECISIONS.has(d.code));
  if (item.question?.answer?.key === "skip") return skipped(item.show, "skipped_by_answer", decisions);
  const show = await applyShowAnswer(item.show, item.question);

  // 0. Already on the site by a supplier id (definitive, and cheaper than the supplier calls)? The
  //    name + day check waits for the names and the location's IATA (step 3). The item's own earlier
  //    event (a rebuild) is not a duplicate of itself. A test run's duplicates include test events.
  const existing = (await existingForShow(show, ctx.subject, run.is_test)).filter((e) => e.id !== item.event_id);
  const byEid = existingEventFor({ ...show, name_english: "" }, existing); // a blank name = the eid check alone
  if (byEid) {
    return skipped(show, "exists", [...decisions, decision("duplicate_dropped", { name: byEid.name_english ?? show.name_english, event_id: byEid.id })]);
  }

  // 1. Tickets. Rates once per build - a failed refresh keeps the cached rates (the attach flow's rule).
  const { multiCurrencyExchangeRateService } = await import("@/lib/services/ticket-price-sync");
  try {
    await multiCurrencyExchangeRateService.updateAllExchangeRates();
  } catch (e) {
    console.warn("uploader-build: using cached exchange rates", e instanceof Error ? e.message : String(e));
  }
  const tixRef = show.suppliers.tixstock;
  const liveRef = show.suppliers.livetickets;
  const [tix, live] = await Promise.all([
    tixRef ? tixstockTickets(tixRef.event_id) : null,
    liveRef ? liveTickets(liveRef.event_id) : null,
  ]);
  const unreachable: Supplier[] = [];
  if (tix && !tix.reached) unreachable.push("tixstock");
  if (live && !live.reached) unreachable.push("livetickets");
  let tickets: EventTicket[] = [...(tix?.tickets ?? []), ...(live?.tickets ?? [])];
  pushUnique(decisions, [...(tix?.decisions ?? []), ...(live?.decisions ?? [])]);
  const suppliersUsed: Supplier[] = [];
  if ((tix?.tickets.length ?? 0) > 0) suppliersUsed.push("tixstock");
  if ((live?.tickets.length ?? 0) > 0) suppliersUsed.push("livetickets");

  if (tickets.length === 0) {
    if (unreachable.length > 0) {
      // Silence is not "sells nothing": an error the board can retry, never a skip.
      throw new Error(`${unreachable.map((s) => (s === "tixstock" ? "TixStock" : "LiveTickets")).join(" + ")} did not answer (after a retry) - build again later`);
    }
    return skipped(show, "no_tickets", decisions);
  }

  // 2. Location: the reads, then the pure decision tree.
  const placed = decidePlace(await readPlaceInput(run, item, show, ctx));
  if (placed.kind === "error") throw new Error(placed.message);
  pushUnique(decisions, placed.decisions);
  if (placed.kind === "ask") return { status: "question", item: { status: "question", show, question: placed.question, decisions } };
  if (placed.kind === "skip") {
    // Only the far-venue offer belongs on a skipped card - not the subject's page warnings.
    const offer = warningsFor(ctx.subject.kind, ctx.rows, {
      newVenue: false,
      unzoned: 0,
      totalTickets: 0,
      suppliersUsed: [],
      unreachable: [],
      hebrewName: true,
      farVenue: placed.farVenue,
    }).filter((w) => w.code === "far_venue");
    return skipped(show, placed.reason, decisions, offer, placed.itemLocation);
  }

  // 3. Names, then: already on the site? Name + day again, now with the located IATA (the search had
  //    none) - under the convention name the event carries (music: "Eric Clapton") AND the supplier's
  //    own title ("Eric Clapton London"), so neither spelling of an existing event slips through.
  const names = eventNames(ctx.subject.kind, show, ctx.subject, withSupplierSpellings(ctx.teamsHe, [show.home_team, show.away_team]), liveRef?.name_heb ?? null);
  const iata = placed.location.city_iata || null;
  const duplicate = existingEventFor({ ...show, name_english: names.name_english }, existing, iata) ?? existingEventFor(show, existing, iata);
  if (duplicate) {
    return skipped(show, "exists", [...decisions, decision("duplicate_dropped", { name: duplicate.name_english ?? show.name_english, event_id: duplicate.id })]);
  }

  // 4. Map + zones.
  let mapImageUrl = "";
  let newVenue = true;
  let unzoned = tickets.length;
  const template = tixRef?.venue_map_url ? await venueMapFor(tixRef.venue_map_url) : null;
  if (tixRef?.venue_map_url && template?.svg_url) {
    mapImageUrl = template.svg_url;
    newVenue = false;
    tickets = zoneFromTemplate(tickets, "tx_event", template);
    const zoned = tickets.filter((t) => !!t.zoneId).length;
    unzoned = tickets.length - zoned;
    decisions.push(decision("zones_from_template", { zoned, total: tickets.length }));
  } else if (tixRef?.venue_map_url) {
    mapImageUrl = tixRef.venue_map_url;
  } else if (liveRef) {
    // LiveTickets-only: their own picture of the venue (Hebrew first), unzoned.
    const { data, error } = await supabaseTyped.from("live_events").select("venue_map_heb_url,venue_map_url").eq("event_id", liveRef.event_id).maybeSingle();
    if (error) {
      console.error("uploader-build: live_events (map) read failed", JSON.stringify(error));
      throw new Error(`live_events read failed: ${error.message}`);
    }
    mapImageUrl = (data?.venue_map_heb_url || data?.venue_map_url || "").trim();
  }

  // 5. Dates.
  const smart = calculateSmartDates(show.date);
  decisions.push(decision("dates_smart", { depart: dayMonth(smart.departure), ret: dayMonth(smart.return) }));

  // 6. Bases - package only, through the one pricing rule.
  let baseFlight: number | null = 0;
  let baseHotel: number | null = 0;
  if (placed.mode === "package") {
    const loc = placed.location;
    [baseFlight, baseHotel] = await Promise.all([
      quoteTwice(() => quoteFlight(loc.city_iata, smart.departure, smart.return)),
      quoteTwice(() => quoteHotel(loc.latitude, loc.longitude, smart.departure, smart.return)),
    ]);
    if (baseFlight !== null && baseHotel !== null) decisions.push(decision("base_prices", { flight: baseFlight, hotel: baseHotel }));
  }

  // 7. Create - hidden, through the same function every path uses (auto-tags, price light rule-only).
  const draft: Omit<Event, "id"> = {
    name: names.name,
    name_english: names.name_english,
    type: "tx_event",
    date: show.date,
    location: placed.location,
    map_image_url: mapImageUrl,
    description: `${names.name_english} at ${show.venue || show.city}`,
    card_image_url: "",
    tickets_and_rates: tickets,
    def_date_depart: smart.departure,
    def_date_return: smart.return,
    usual_price: 0,
    base_flight_price: baseFlight ?? 0,
    base_hotel_price: baseHotel ?? 0,
    is_prioritized: false,
    is_deleted: "",
    tags: "",
    skip_flight: true,
    is_hidden: true,
    is_test: run.is_test,
    tx_excluded_sections: [],
    ticket_only_markup: run.plan.markups.ticket_only,
    event_additional_markup: run.plan.markups.additional,
    package_mode: placed.mode,
    ...placed.lodging,
  };
  const { createEvent } = await import("@/lib/actions/event-actions");
  const created = await createEvent(draft);
  // The item points at its event BEFORE anything else can fail or time out: an action cut off from
  // here on never leaves a hidden event that no item points at. A failed write is logged only - the
  // caller writes the whole result (event_id included) at the end anyway.
  const linked = await db.from("uploader_items").update({ event_id: created.id }).eq("id", item.id);
  if (linked.error) console.error(`uploader-build: event_id ${created.id} not written on item ${item.id}`, JSON.stringify(linked.error));
  const payload: Record<string, unknown> = Object.fromEntries(Object.entries(created).filter(([k]) => !VOLATILE_COLUMN.test(k)));

  // 8. Warnings (subject pages + what the build found) and blockers.
  const facts: BuildFacts = {
    newVenue,
    unzoned,
    totalTickets: tickets.length,
    suppliersUsed,
    unreachable,
    hebrewName: names.hebrew,
    farVenue: placed.mode === "package" ? null : placed.farVenue,
  };
  const warnings = warningsFor(ctx.subject.kind, ctx.rows, facts);
  const fixPrice = `/events/${created.id}#fix-price`;
  const blockers: Warning[] = [];
  if (baseFlight === null) blockers.push({ code: "no_base_price", text: WARNING_TEXT.no_base_price, fix_url: fixPrice });
  if (baseHotel === null) blockers.push({ code: "no_base_price", text: WARNING_TEXT.no_base_price_hotel, fix_url: fixPrice });
  // A ticket-only event is priced ticket + ticket_only_markup alone: built with null, never approved with it.
  if (placed.mode === "ticket_only" && run.plan.markups.ticket_only === null) {
    blockers.push({ code: "no_ticket_only_markup", text: WARNING_TEXT.no_ticket_only_markup, fix_url: fixPrice });
  }

  await logAudit({
    action: "uploader.built",
    entityType: "uploader_item",
    entityId: item.id,
    metadata: { agent: "tour-uploader", run_id: run.id, item_id: item.id, event_id: created.id, decisions: decisions.map((d) => d.code) },
  });

  return {
    status: "ready",
    item: {
      status: "ready",
      show,
      mode: placed.mode,
      location: placed.itemLocation,
      decisions,
      warnings,
      blockers,
      event_id: created.id,
      payload,
      skip_reason: null,
      error: null,
    },
  };
}

/**
 * Build one show (spec 9). Never throws: a failure anywhere is `{ status: "error", item: { error } }`
 * with the reason. On "question" the caller opens the task (`openQuestionTask`); on "ready" the
 * hidden event exists (`item.event_id`) and `item.payload` is its row as created.
 */
export async function buildItem(run: UploaderRun, item: UploaderItem, ctx: BuildContext): Promise<BuildResult> {
  try {
    return await build(run, item, ctx);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`uploader-build: item ${item.id} failed`, message);
    return { status: "error", item: { status: "error", error: message } };
  }
}
