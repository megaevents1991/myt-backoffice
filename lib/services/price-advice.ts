// Price advice for a RED light - the deterministic half of agent #2 ("יועץ מחיר").
//
// Pure: no DB, no fetch, relative imports only, so it runs under plain `node` from
// scripts/price-light-selftest.ts. It states FACTS - numbers that follow from the comparison the
// light already made - and never a recommendation it cannot back with one of them. The advisor
// agent (lib/agents/price-advisor.agent.ts) may only re-word and rank these lines; with the agent
// switched off, the task simply gets them as they are.
//
// It never writes anything. The one price write in this feature is a human's
// (`setEventMarkupFromLight`), and it is a markup - never a base price.
import {
  LIGHT_GREEN_USD, LIGHT_RED_USD, minAvailableTicketUsd, ourNightRateUsd,
  type PricedEvent,
} from "./price-light.ts";
import type { AltSupplierQuote, LightScopeDetail, OurAlternatives, Scope } from "../../types/price-light.types";

export type AdviceKind = "markup_cut" | "cheaper_ticket" | "nights" | "no_room" | "alt_dates" | "supplier_swap";

export interface PriceAdviceFact {
  kind: AdviceKind;
  /** One Hebrew sentence, ready for a task description. */
  text: string;
  /** What acting on it would save per person, when that is a number we can stand behind. */
  saves_usd: number | null;
}

/** Cuts are suggested in whole fives - nobody types "$133" into a markup field. */
function ceil5(n: number): number {
  return Math.ceil(n / 5) * 5;
}

/**
 * The markup cut that would move a red scope to orange, and to green, given the band the light
 * itself used (`lightFor`: red above LIGHT_RED_USD + doubt, green below LIGHT_GREEN_USD - doubt).
 * `markupUsd` is what there is to cut FROM THE LIGHT: the per-event extra markup
 * (`event_additional_markup`) for a package, the ticket-only markup for a ticket. Main's global
 * $175 and the composed markups are not editable there, so counting them promised a cut nobody
 * could make ("נשאר מארקאפ $25" on an event whose editable markup was $0).
 */
export function markupCutFacts(scope: Scope, diffUsd: number, uncertaintyUsd: number, markupUsd: number): PriceAdviceFact[] {
  const toOrange = ceil5(diffUsd - (LIGHT_RED_USD + uncertaintyUsd));
  if (toOrange <= 0) return [];
  const toGreen = ceil5(diffUsd - (LIGHT_GREEN_USD - uncertaintyUsd) + 1);
  const what = scope === "package" ? "המארקאפ הנוסף של החבילה" : "מארקאפ הכרטיס";
  if (toOrange > markupUsd) {
    return [{
      kind: "no_room",
      text: `${what} הוא $${markupUsd}, וכדי לרדת לכתום צריך להוריד $${toOrange}. המארקאפ שנערך מהרמזור לא יסגור את הפער לבדו.`,
      saves_usd: null,
    }];
  }
  const green = toGreen <= markupUsd
    ? ` לירוק צריך $${toGreen} (נשאר $${markupUsd - toGreen}).`
    : ` לירוק צריך $${toGreen}, יותר מכל המארקאפ.`;
  return [{
    kind: "markup_cut",
    text: `הורדת ${what} ב-$${toOrange} מביאה לכתום (נשאר מארקאפ $${markupUsd - toOrange}).${green}`,
    saves_usd: toOrange,
  }];
}

/**
 * Our cheapest ticket against LiveTickets' shelf price for the SAME event. LiveTickets is also a
 * supplier of ours, so their shelf price is a price we could buy at: when our cheapest category
 * costs clearly more, sourcing it there is a real option. `liveTicketsUsd` comes from the ticket
 * scope's `per_competitor.livetickets.normalized_usd` - already matched to this event by the light.
 */
export function cheaperTicketFact(ourTicketCostUsd: number | null, liveTicketsUsd: number | null): PriceAdviceFact[] {
  if (ourTicketCostUsd == null || liveTicketsUsd == null) return [];
  const gap = Math.round(ourTicketCostUsd - liveTicketsUsd);
  if (gap < 20) return [];
  return [{
    kind: "cheaper_ticket",
    text: `הכרטיס הזול שלנו עולה $${Math.round(ourTicketCostUsd)} ואילו LiveTickets מוכרים את אותו אירוע מ-$${liveTicketsUsd}. רכישה דרכם חוסכת כ-$${gap} לכרטיס.`,
    saves_usd: gap,
  }];
}

/** A package a night longer than theirs costs a night more - priced at OUR own night rate. */
export function nightsFact(e: PricedEvent, nightsOurs: number | null, nightsTheirs: number | null): PriceAdviceFact[] {
  if (nightsOurs == null || nightsTheirs == null || nightsOurs <= nightsTheirs) return [];
  const extra = nightsOurs - nightsTheirs;
  const rate = Math.round(ourNightRateUsd(e));
  return [{
    kind: "nights",
    text: `החבילה שלנו ${nightsOurs} לילות מול ${nightsTheirs} אצלם. כל לילה פחות חוסך כ-$${rate} לאדם (${extra === 1 ? "לילה אחד" : `${extra} לילות`} = $${rate * extra}).`,
    saves_usd: rate * extra,
  }];
}

// ---- other travel days, other ticket suppliers (staff doc note 6, 2026-09-18) -----------------
// Both are FACTS like the rest: the prices were quoted by lib/services/price-alternatives.ts (real
// Amadeus searches, the suppliers' own catalogs) and stored under `light_detail.ours.alt`. This
// file only does the arithmetic and the wording - it still searches nothing and writes nothing.

/** A saving smaller than this is inside the noise of a flight search made a day apart. */
export const ALT_DATES_MIN_SAVING_USD = 30;
/** Same floor the LiveTickets fact has always used. */
export const SUPPLIER_MIN_SAVING_USD = 20;
const ALT_DATES_SHOWN = 2;

const DAY_MS = 86_400_000;
const shiftDay = (day: string, delta: number): string =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + delta * DAY_MS).toISOString().slice(0, 10);
const nightsOf = (depart: string, ret: string): number =>
  Math.round((Date.parse(`${ret}T00:00:00.000Z`) - Date.parse(`${depart}T00:00:00.000Z`)) / DAY_MS);
const dayMonth = (day: string): string => `${day.slice(8, 10)}.${day.slice(5, 7)}`;

/**
 * The travel windows worth quoting around one event: leave a day later, come back a day earlier,
 * both, or the same length shifted a day either way. Two rules our own packages already keep
 * bound every one of them - land at least the day BEFORE the event, fly home the day AFTER it at
 * the earliest - and nothing leaves before tomorrow. The current window is never in the list.
 */
export function altDateCandidates(eventDay: string, depart: string, ret: string, today: string): { depart: string; return: string }[] {
  const latestDepart = shiftDay(eventDay, -1);
  const earliestReturn = shiftDay(eventDay, 1);
  const tomorrow = shiftDay(today, 1);
  const tries: [number, number][] = [[1, 0], [0, -1], [1, -1], [-1, -1], [1, 1]];
  const seen = new Set<string>([`${depart}|${ret}`]);
  const out: { depart: string; return: string }[] = [];
  for (const [dDepart, dReturn] of tries) {
    const d = shiftDay(depart, dDepart);
    const r = shiftDay(ret, dReturn);
    if (d > latestDepart || r < earliestReturn || d < tomorrow || seen.has(`${d}|${r}`)) continue;
    seen.add(`${d}|${r}`);
    out.push({ depart: d, return: r });
  }
  return out;
}

/**
 * Other travel days that come out cheaper. The flight difference is a quoted number (same rule,
 * same minute as the baseline); a shorter stay is priced at OUR own night rate, like `nightsFact` -
 * the hotel itself is not re-searched per window, and the sentence says so.
 */
export function altDatesFacts(e: PricedEvent, alt: Pick<OurAlternatives, "base" | "dates"> | null | undefined): PriceAdviceFact[] {
  const base = alt?.base;
  if (!base || !alt?.dates?.length) return [];
  const rate = Math.round(ourNightRateUsd(e));
  return alt.dates
    .map((q) => {
      const fewer = base.nights - q.nights;
      return { q, fewer, saves: Math.round(base.flight_usd - q.flight_usd + fewer * rate) };
    })
    .filter((x) => x.saves >= ALT_DATES_MIN_SAVING_USD && x.fewer >= 0)
    .sort((a, b) => b.saves - a.saves)
    .slice(0, ALT_DATES_SHOWN)
    .map(({ q, fewer, saves }) => {
      const stay = fewer > 0
        ? `, ו${fewer === 1 ? "לילה אחד" : `${fewer} לילות`} פחות במלון (כ-$${rate} ללילה, לפי תעריף הלילה שלנו)`
        : "";
      const flight = q.flight_usd === base.flight_usd ? `הטיסה באותו מחיר ($${q.flight_usd})` : `טיסה $${q.flight_usd} במקום $${base.flight_usd}`;
      return {
        kind: "alt_dates" as const,
        text: `יציאה ${dayMonth(q.depart)} וחזרה ${dayMonth(q.return)} במקום ${dayMonth(base.depart)}–${dayMonth(base.return)}: ${flight}${stay}. חוסך כ-$${saves} לאדם.`,
        saves_usd: saves,
      };
    });
}

const SUPPLIER_HE: Record<AltSupplierQuote["supplier"], string> = { livetickets: "LiveTickets", tixstock: "TixStock", xs2event: "XS2Event" };

/**
 * The same event's cheapest ticket at a supplier we do not source it from. `sell_usd` is that
 * supplier's cost through OUR markup, so it is compared with our cheapest ticket like for like.
 * A supplier that cannot be attached to an event today is still said - as information, in so
 * many words, because an advice nobody can act on must not read like one they can.
 */
export function supplierSwapFacts(ourTicketUsd: number | null, suppliers: AltSupplierQuote[] | null | undefined): PriceAdviceFact[] {
  if (ourTicketUsd == null || !suppliers?.length) return [];
  const ours = Math.round(ourTicketUsd);
  return suppliers
    .map((s) => ({ s, gap: ours - Math.round(s.sell_usd) }))
    .filter((x) => x.gap >= SUPPLIER_MIN_SAVING_USD)
    .sort((a, b) => b.gap - a.gap)
    .map(({ s, gap }) => ({
      kind: "supplier_swap" as const,
      text: `${SUPPLIER_HE[s.supplier]} מוכרים את אותו אירוע${s.category ? ` (${s.category})` : ""} ב-${Math.round(s.cost)} ${s.currency}; אחרי המארקאפ שלנו זה $${Math.round(s.sell_usd)} מול $${ours} לכרטיס הזול שלנו - חוסך כ-$${gap} לכרטיס. ${
        s.attachable ? "אפשר לצרף אותו כספק נוסף ב-Suppliers & zones של האירוע." : "היום אי אפשר לצרף אותו כספק שני - מידע בלבד."}`,
      saves_usd: gap,
    }));
}

/**
 * Everything we can say about one red scope, biggest saving first. `liveTicketsUsd` is the ticket
 * scope's LiveTickets answer (null when they do not sell it or it is not priced).
 */
export function priceAdviceFacts(input: {
  event: PricedEvent;
  scope: Scope;
  detail: Pick<LightScopeDetail, "diff_usd" | "uncertainty_usd" | "nights">;
  liveTicketsUsd: number | null;
  /** `light_detail.ours.alt` - other travel days and other suppliers, when they were quoted. */
  alt?: OurAlternatives | null;
}): PriceAdviceFact[] {
  const { event, scope, detail } = input;
  if (detail.diff_usd == null) return [];
  const uncertainty = Math.max(0, Math.round(detail.uncertainty_usd ?? 0));
  const editable = scope === "package" ? event.event_additional_markup : event.ticket_only_markup;
  const markup = Math.max(0, Number(editable ?? 0) || 0);
  const theirs = typeof detail.nights?.theirs === "number" ? detail.nights.theirs : null;
  const ourTicket = minAvailableTicketUsd(event);
  const swaps = supplierSwapFacts(ourTicket, input.alt?.suppliers);
  // The quoted LiveTickets alternative (category, cost, our markup) says more than the older
  // shelf-price line about the same supplier - one of the two, never both.
  const liveTicketsQuoted = (input.alt?.suppliers ?? []).some((s) => s.supplier === "livetickets");
  const facts = [
    ...markupCutFacts(scope, detail.diff_usd, uncertainty, markup),
    ...(liveTicketsQuoted ? [] : cheaperTicketFact(ourTicket, input.liveTicketsUsd)),
    ...swaps,
    ...(scope === "package" ? nightsFact(event, detail.nights?.ours ?? null, theirs) : []),
    ...(scope === "package" ? altDatesFacts(event, input.alt) : []),
  ];
  return facts.sort((a, b) => (b.saves_usd ?? -1) - (a.saves_usd ?? -1));
}

/** The block appended to an auto-opened red task. Empty string when there is nothing to say. */
export function adviceBlock(facts: PriceAdviceFact[]): string {
  if (facts.length === 0) return "";
  return ["הצעות לשיפור המחיר (עובדות, לא החלטה):", ...facts.map((f) => `• ${f.text}`)].join("\n");
}
