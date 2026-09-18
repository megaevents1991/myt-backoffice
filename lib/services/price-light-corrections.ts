/**
 * Staff corrections to what a competitor listing says (2026-09-18, Dor: "מחיר שדוגם היה נמוך
 * מוגזם, ושאני אוכל לערוך ו-הAI ילמד מזה").
 *
 * A correction is an OVERLAY on a crawled listing, never a write to it - the next crawl would
 * overwrite the row. Precedence, per field: staff > page > AI. Two scopes:
 *   - `not_same_event` belongs to one (event, listing) PAIR: the listing drops out of that event's
 *     candidates and stays a candidate for every other event.
 *   - every other field belongs to the LISTING, so it follows it into every event matched to it.
 *
 * A correction is LIVE while it is not revoked and the crawled value still equals the `original`
 * it was made against. When the source itself changes the market moved and the correction is
 * stale - the same idea as the light override's drift rule - and should the old value come back
 * (a parser that keeps misreading the same page) the correction is live again. Nothing is
 * expired by a write: liveness is computed on every read, here.
 *
 * Pure - rows in, rows out, no DB, no fetch - so scripts/price-light-corrections-selftest.ts runs
 * it under plain node. The table access is price-light-corrections-store.ts.
 */
import type { Currency, ExtractedAttrs, ListingRow, OfferDetail } from "../../types/price-light.types";

export const ATTR_FIELDS = ["nights", "hotel_stars", "breakfast", "bag_included", "direct_flight", "transfers"] as const;
export type AttrField = (typeof ATTR_FIELDS)[number];
export const TEXT_FIELDS = ["airline", "hotel_name", "ticket"] as const;
export type TextField = (typeof TEXT_FIELDS)[number];
export const CORRECTION_FIELDS = ["price", "not_same_event", ...ATTR_FIELDS, ...TEXT_FIELDS] as const;
export type CorrectionField = (typeof CORRECTION_FIELDS)[number];

/** Why the sampled value was wrong. Structured on purpose: a picked reason is a label the agent
 *  and the parser report can count; the free note beside it is the human's own sentence. */
export const CORRECTION_REASONS = [
  { id: "wrong_listing", he: "זו לא המודעה של האירוע הזה" },
  { id: "partial_price", he: "המחיר הוא לחלק מהחבילה (כרטיס בלבד / ילד / בלי טיסה)" },
  { id: "parser_misread", he: "המערכת קראה את הדף לא נכון" },
  { id: "outdated", he: "הדף של המתחרה השתנה מאז הסריקה" },
  { id: "ai_wrong", he: "ה-AI טעה" },
  { id: "other", he: "אחר" },
] as const;
export type CorrectionReason = (typeof CORRECTION_REASONS)[number]["id"];

/** Who produced the value staff corrected - what decides whether the AI has anything to learn. */
export type CorrectionSource = "page" | "parser" | "ai" | "rule" | "none";

export const CORRECTION_NOTE_MIN = 3;
export const CORRECTION_NOTE_MAX = 400;
export const CORRECTION_TEXT_MAX = 120;
const CURRENCIES: readonly Currency[] = ["USD", "EUR", "GBP", "ILS"];

export interface PriceValue { amount: number; currency: Currency }
/** null = "we do not know" - for an attribute, it takes the adjustment out of the comparison. */
export type CorrectionValue = PriceValue | number | boolean | string | null;

export interface ListingCorrection {
  id: number;
  listing_id: number;
  /** Set only for `not_same_event`. */
  event_id: number | null;
  competitor: string;
  field: CorrectionField;
  original: CorrectionValue;
  value: CorrectionValue;
  reason: CorrectionReason | null;
  note: string;
  source: CorrectionSource | null;
  created_by: string | null;
  created_at: string;
  revoked_at: string | null;
}

export function isAttrField(field: string): field is AttrField {
  return (ATTR_FIELDS as readonly string[]).includes(field);
}
export function isTextField(field: string): field is TextField {
  return (TEXT_FIELDS as readonly string[]).includes(field);
}

/** "unknown", undefined and "" all mean the same thing as null: the source did not say. */
function known(v: unknown): CorrectionValue {
  if (v === undefined || v === null || v === "unknown" || v === "") return null;
  return v as CorrectionValue;
}

export function sameValue(a: CorrectionValue | undefined, b: CorrectionValue | undefined): boolean {
  const x = known(a);
  const y = known(b);
  if (x === null || y === null) return x === y;
  if (typeof x === "object" && typeof y === "object") return Number(x.amount) === Number(y.amount) && x.currency === y.currency;
  if (typeof x === "object" || typeof y === "object") return false;
  if (typeof x === "number" || typeof y === "number") return Number(x) === Number(y);
  return x === y;
}

type ListingFacts = Pick<ListingRow, "id" | "price_from" | "currency" | "attrs">;

/**
 * What the CRAWL says for this field right now - the value a correction's `original` is compared
 * with. Attributes read the listing's own (page) attrs, never the AI's: staleness is about the
 * source page changing. Text fields need the parsed detail text; without it they have no current
 * value and are skipped by the matcher, which never looks at them anyway.
 */
export function crawledValue(field: CorrectionField, listing: ListingFacts, parsed: OfferDetail | null): CorrectionValue {
  if (field === "not_same_event") return null;
  if (field === "price") {
    return listing.price_from == null || listing.currency == null ? null : { amount: Number(listing.price_from), currency: listing.currency };
  }
  if (isAttrField(field)) return known(listing.attrs?.[field]);
  if (field === "airline") return known(parsed?.flight?.airline);
  if (field === "hotel_name") return known(parsed?.hotel?.name);
  return known(parsed?.ticket);
}

/** Live for THIS event: not revoked, in scope, and made against the value the crawl still shows. */
export function liveCorrections(
  corrections: ListingCorrection[], listing: ListingFacts, parsed: OfferDetail | null, eventId: number,
): ListingCorrection[] {
  return corrections.filter((c) => {
    if (c.listing_id !== listing.id || c.revoked_at != null) return false;
    if (c.field === "not_same_event") return c.event_id === eventId;
    if (c.event_id != null) return false;
    if (isTextField(c.field) && parsed == null) return false;
    return sameValue(c.original, crawledValue(c.field, listing, parsed));
  });
}

/**
 * The matcher's view of a competitor's candidates with staff corrections laid over them: a
 * listing staff said is not this event is gone, a corrected price replaces the crawled one
 * (`usdOf` is the caller's converter - it lives with the exchange-rate service, not here), and
 * the attribute corrections come back per listing for the merge that follows the AI/page merge.
 */
export function correctCandidates<T extends ListingRow>(
  candidates: T[], corrections: ListingCorrection[], eventId: number,
  usdOf: (amount: number, currency: Currency) => number,
): { candidates: T[]; attrFixes: Map<number, ListingCorrection[]> } {
  const attrFixes = new Map<number, ListingCorrection[]>();
  const out: T[] = [];
  for (const candidate of candidates) {
    const live = liveCorrections(corrections, candidate, null, eventId);
    if (live.some((c) => c.field === "not_same_event")) continue;
    const price = live.find((c) => c.field === "price")?.value;
    const fixes = live.filter((c) => isAttrField(c.field));
    if (fixes.length > 0) attrFixes.set(candidate.id, fixes);
    if (price && typeof price === "object") {
      out.push({ ...candidate, price_from: price.amount, currency: price.currency, price_usd: usdOf(price.amount, price.currency) });
    } else out.push(candidate);
  }
  return { candidates: out, attrFixes };
}

/** Staff wins per field, over whatever the page/AI merge produced. null -> "unknown". */
export function correctAttrs(attrs: Partial<ExtractedAttrs>, fixes: ListingCorrection[]): Partial<ExtractedAttrs> {
  if (fixes.length === 0) return attrs;
  const out: Record<string, unknown> = { ...attrs };
  for (const fix of fixes) if (isAttrField(fix.field)) out[fix.field] = fix.value ?? "unknown";
  return out as Partial<ExtractedAttrs>;
}

/**
 * The comparison sheet's view: what the listing CONTAINS with the corrections applied. The parsed
 * text normally wins over attrs for stars / board / bag / direct, so a corrected attribute has to
 * be written onto the parsed detail as well or the sheet would keep showing the value staff fixed.
 */
export function correctOffer(detail: OfferDetail, fixes: ListingCorrection[]): OfferDetail {
  if (fixes.length === 0) return detail;
  const flight = detail.flight ? { ...detail.flight } : { airline: null, direct: null, bag: null, out: null, back: null };
  const hotel = detail.hotel ? { ...detail.hotel } : { name: null, stars: null, board: null };
  let ticket = detail.ticket;
  let touchedFlight = false;
  let touchedHotel = false;
  for (const fix of fixes) {
    const v = fix.value;
    switch (fix.field) {
      case "airline": flight.airline = typeof v === "string" ? v : null; touchedFlight = true; break;
      case "direct_flight": flight.direct = typeof v === "boolean" ? v : null; touchedFlight = true; break;
      case "bag_included": flight.bag = v === true ? "כולל מזוודה" : v === false ? "טרולי בלבד" : null; touchedFlight = true; break;
      case "hotel_name": hotel.name = typeof v === "string" ? v : null; touchedHotel = true; break;
      case "hotel_stars": hotel.stars = typeof v === "number" ? v : null; touchedHotel = true; break;
      case "breakfast": hotel.board = v === true ? "breakfast" : v === false ? "room_only" : null; touchedHotel = true; break;
      case "ticket": ticket = typeof v === "string" ? v : null; break;
      default: break;
    }
  }
  return {
    ...detail,
    flight: detail.flight || touchedFlight ? flight : null,
    hotel: detail.hotel || touchedHotel ? hotel : null,
    ticket,
  };
}

/** The value as it may be stored, or the reason it may not. Bounds are sanity, not policy. */
export function validateCorrection(field: CorrectionField, value: unknown): { ok: true; value: CorrectionValue } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  if (field === "not_same_event") return value === true ? { ok: true, value: true } : bad("not_same_event takes true");
  if (field === "price") {
    const p = value as Partial<PriceValue> | null;
    const amount = Number(p?.amount);
    if (!p || !Number.isFinite(amount) || amount < 1 || amount > 100_000) return bad("price must be 1..100000");
    if (!CURRENCIES.includes(p.currency as Currency)) return bad("unknown currency");
    return { ok: true, value: { amount: Math.round(amount), currency: p.currency as Currency } };
  }
  if (value === null) return { ok: true, value: null };
  if (field === "nights" || field === "hotel_stars") {
    const n = Number(value);
    const max = field === "nights" ? 21 : 5;
    if (!Number.isInteger(n) || n < 1 || n > max) return bad(`${field} must be 1..${max}`);
    return { ok: true, value: n };
  }
  if (isAttrField(field)) return typeof value === "boolean" ? { ok: true, value } : bad(`${field} takes true/false`);
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text || text.length > CORRECTION_TEXT_MAX) return bad(`${field} must be 1..${CORRECTION_TEXT_MAX} characters`);
  return { ok: true, value: text };
}

const FIELD_EN: Record<CorrectionField, string> = {
  price: "price", not_same_event: "same-event match", nights: "nights", hotel_stars: "hotel stars",
  breakfast: "breakfast", bag_included: "checked bag", direct_flight: "direct flight", transfers: "transfers",
  airline: "airline", hotel_name: "hotel name", ticket: "ticket category",
};

function show(v: CorrectionValue | undefined): string {
  const k = known(v);
  if (k === null) return "unknown";
  if (typeof k === "object") return `${k.amount} ${k.currency}`;
  return String(k);
}

/** One correction as a line of evidence for an agent's memory ("golasso hotel stars: 3 -> 4 ..."). */
export function correctionLessonText(m: {
  competitor?: unknown; field?: unknown; from?: unknown; to?: unknown; source?: unknown; reason?: unknown; note?: unknown;
  listing_title?: unknown; event_name?: unknown;
}): string | null {
  const field = typeof m.field === "string" && (CORRECTION_FIELDS as readonly string[]).includes(m.field) ? (m.field as CorrectionField) : null;
  const note = typeof m.note === "string" ? m.note.trim() : "";
  if (!field || !note) return null;
  const who = typeof m.competitor === "string" ? m.competitor : "competitor";
  const by = m.source === "ai" ? "the AGENT's" : m.source === "page" || m.source === "parser" ? "the crawler's" : "the";
  const reason = typeof m.reason === "string" ? ` [${m.reason}]` : "";
  if (field === "not_same_event") {
    // The title is the evidence here: it is what was (wrongly) read as our event.
    const title = typeof m.listing_title === "string" && m.listing_title.trim() ? ` "${m.listing_title.trim().slice(0, 60)}"` : "";
    const ours = typeof m.event_name === "string" && m.event_name.trim() ? ` "${m.event_name.trim().slice(0, 60)}"` : "";
    const matcher = m.source === "ai" ? "the AGENT" : m.source === "rule" ? "the rule matcher" : "the matcher";
    return `${who}: ${matcher} paired listing${title} with our event${ours}; a human said it is NOT the same event${reason} and wrote: "${note}"`;
  }
  return `${who}: a human corrected ${by} ${FIELD_EN[field]} from ${show(m.from as CorrectionValue)} to ${show(m.to as CorrectionValue)}${reason} and wrote: "${note}"`;
}
