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
import type { LightScopeDetail, Scope } from "../../types/price-light.types";

export type AdviceKind = "markup_cut" | "cheaper_ticket" | "nights" | "no_room";

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

/**
 * Everything we can say about one red scope, biggest saving first. `liveTicketsUsd` is the ticket
 * scope's LiveTickets answer (null when they do not sell it or it is not priced).
 */
export function priceAdviceFacts(input: {
  event: PricedEvent;
  scope: Scope;
  detail: Pick<LightScopeDetail, "diff_usd" | "uncertainty_usd" | "nights">;
  liveTicketsUsd: number | null;
}): PriceAdviceFact[] {
  const { event, scope, detail } = input;
  if (detail.diff_usd == null) return [];
  const uncertainty = Math.max(0, Math.round(detail.uncertainty_usd ?? 0));
  const editable = scope === "package" ? event.event_additional_markup : event.ticket_only_markup;
  const markup = Math.max(0, Number(editable ?? 0) || 0);
  const theirs = typeof detail.nights?.theirs === "number" ? detail.nights.theirs : null;
  const facts = [
    ...markupCutFacts(scope, detail.diff_usd, uncertainty, markup),
    ...cheaperTicketFact(minAvailableTicketUsd(event), input.liveTicketsUsd),
    ...(scope === "package" ? nightsFact(event, detail.nights?.ours ?? null, theirs) : []),
  ];
  return facts.sort((a, b) => (b.saves_usd ?? -1) - (a.saves_usd ?? -1));
}

/** The block appended to an auto-opened red task. Empty string when there is nothing to say. */
export function adviceBlock(facts: PriceAdviceFact[]): string {
  if (facts.length === 0) return "";
  return ["הצעות לשיפור המחיר (עובדות, לא החלטה):", ...facts.map((f) => `• ${f.text}`)].join("\n");
}
