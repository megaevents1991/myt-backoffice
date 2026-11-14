/**
 * The Meta feed's abnormal-price guard (Dor 14.11.2026: "איך אנחנו מונעים מכאלה להגיע לפיד שלנו?").
 * Pure: no DB, no network. I/O in lib/services/feed-price-guard.ts; selftest
 * scripts/feed-price-guard-selftest.ts.
 *
 * Event 918 (Bob Dylan, London 08.12): on 13.11 the cheaper TixStock categories went off sale and
 * the one left cost $18,672 a ticket, so the site card - and the creative the hourly cron redrew
 * that night - said $19,907 a traveller. It was a real price, not a bug, and it ran in the
 * catalog for a day and a half. A price like that now holds the event OUT of the feed (its
 * creative is taken off; both feeds leave an event with no creative out) and mails staff once.
 *
 * Abnormal = the site card over FEED_PRICE_CEILING_USD a traveller, OR the cheapest ticket
 * FEED_JUMP_FACTOR times AND FEED_JUMP_MIN_USD over its normal price. "Normal" = the lower quarter
 * of the last FEED_BASELINE_DAYS daily snapshots (so a spike that sat most of the month is still
 * not normal), frozen on the hold once held. Measured 14.11 over every snapshot since 11.09
 * (26,099 rows, 605 events): both rules caught 918 alone; the dearest event on sale was $2,704.
 */

export const FEED_PRICE_CEILING_USD = 6000;
export const FEED_JUMP_FACTOR = 2.5;
export const FEED_JUMP_MIN_USD = 1000;
export const FEED_BASELINE_DAYS = 30;
export const FEED_BASELINE_MIN_DAYS = 3;
/** The baseline is this quantile of the days, not the median: a spike must hold 3/4 of the month to look normal. */
export const FEED_BASELINE_QUANTILE = 0.25;
/** "The price is right" covers the approved price while it moves less than this share of it. */
export const FEED_APPROVAL_TOLERANCE = 0.1;
/** Every held event's `campaign_skip_reason` starts with it - the creative-gap list skips those rows. */
export const FEED_PRICE_HOLD_PREFIX = "מחיר חריג";

export type FeedPriceHoldReason = "ceiling" | "jump";

export type FeedPriceHold = {
  /** When this hold began (ISO). */
  since: string;
  reason: FeedPriceHoldReason;
  /** The site card price a traveller, USD, as last seen. */
  card_usd: number;
  /** The cheapest ticket on sale, USD, as last seen. */
  ticket_usd: number | null;
  /** The normal cheapest ticket when the hold began - frozen while held. */
  baseline_usd: number | null;
  /** When staff were mailed about it; null = not yet. */
  alerted_at: string | null;
};

export type FeedPriceApproval = { card_usd: number; by: string; at: string };

/** `events.feed_price_guard` (jsonb, null = nothing held, nothing approved). */
export type FeedPriceGuard = { hold: FeedPriceHold | null; approved: FeedPriceApproval | null };

export type FeedPriceVerdict =
  | { abnormal: false }
  | { abnormal: true; reason: FeedPriceHoldReason; baselineUsd: number | null };

const finite = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** Lenient read of the column: anything malformed counts as nothing held, nothing approved. */
export function parseFeedPriceGuard(raw: unknown): FeedPriceGuard {
  const empty: FeedPriceGuard = { hold: null, approved: null };
  if (!raw || typeof raw !== "object") return empty;
  const r = raw as Record<string, unknown>;
  let hold: FeedPriceHold | null = null;
  if (r.hold && typeof r.hold === "object") {
    const h = r.hold as Record<string, unknown>;
    const card = finite(h.card_usd);
    const since = text(h.since);
    if ((h.reason === "ceiling" || h.reason === "jump") && card != null && since) {
      hold = {
        since,
        reason: h.reason,
        card_usd: card,
        ticket_usd: finite(h.ticket_usd),
        baseline_usd: finite(h.baseline_usd),
        alerted_at: text(h.alerted_at),
      };
    }
  }
  let approved: FeedPriceApproval | null = null;
  if (r.approved && typeof r.approved === "object") {
    const a = r.approved as Record<string, unknown>;
    const card = finite(a.card_usd);
    if (card != null && card > 0) approved = { card_usd: card, by: text(a.by) ?? "", at: text(a.at) ?? "" };
  }
  return { hold, approved };
}

/** What to write to the column: null when nothing is held or approved. */
export function storedGuard(guard: FeedPriceGuard): FeedPriceGuard | null {
  return guard.hold || guard.approved ? guard : null;
}

/** The normal cheapest ticket over the given days: their lower quarter; null on fewer than 3 priced days. */
export function priceBaseline(history: number[]): number | null {
  const days = history.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (days.length < FEED_BASELINE_MIN_DAYS) return null;
  return days[Math.floor((days.length - 1) * FEED_BASELINE_QUANTILE)];
}

function isJump(ticketUsd: number | null, baselineUsd: number | null): boolean {
  if (ticketUsd == null || baselineUsd == null || baselineUsd <= 0) return false;
  return ticketUsd >= baselineUsd * FEED_JUMP_FACTOR && ticketUsd - baselineUsd >= FEED_JUMP_MIN_USD;
}

/**
 * Is this price fit for an ad? `history` = the cheapest ticket of each of the last days (any order),
 * `ticketDriven` = false when the card prices a live ready package (it does not follow the cheapest
 * ticket - the ceiling alone applies).
 */
export function feedPriceVerdict(input: {
  cardUsd: number | null;
  ticketUsd: number | null;
  ticketDriven: boolean;
  history: number[];
  guard: FeedPriceGuard;
}): FeedPriceVerdict {
  const { cardUsd, ticketUsd, guard } = input;
  if (cardUsd == null) return { abnormal: false };
  const approved = guard.approved;
  if (approved && Math.abs(cardUsd - approved.card_usd) <= approved.card_usd * FEED_APPROVAL_TOLERANCE) {
    return { abnormal: false };
  }
  const baselineUsd = guard.hold ? guard.hold.baseline_usd : priceBaseline(input.history);
  if (cardUsd > FEED_PRICE_CEILING_USD) return { abnormal: true, reason: "ceiling", baselineUsd };
  if (input.ticketDriven && isJump(ticketUsd, baselineUsd)) return { abnormal: true, reason: "jump", baselineUsd };
  return { abnormal: false };
}

export type GuardStep = { change: "hold" | "keep" | "release" | "none"; next: FeedPriceGuard };

/** The column after a check. A hold keeps its start, baseline and alert stamp; a release keeps the approval. */
export function nextGuard(
  guard: FeedPriceGuard,
  verdict: FeedPriceVerdict,
  seen: { now: string; cardUsd: number | null; ticketUsd: number | null },
): GuardStep {
  if (verdict.abnormal) {
    const card = seen.cardUsd ?? 0;
    // An approval the price has left behind is spent.
    if (guard.hold) {
      return {
        change: "keep",
        next: { hold: { ...guard.hold, reason: verdict.reason, card_usd: card, ticket_usd: seen.ticketUsd }, approved: null },
      };
    }
    return {
      change: "hold",
      next: {
        hold: {
          since: seen.now,
          reason: verdict.reason,
          card_usd: card,
          ticket_usd: seen.ticketUsd,
          baseline_usd: verdict.baselineUsd,
          alerted_at: null,
        },
        approved: null,
      },
    };
  }
  if (guard.hold) return { change: "release", next: { hold: null, approved: guard.approved } };
  return { change: "none", next: guard };
}

/** Mail staff about a hold: held, still on sale (a Sold event needs nobody), not mailed yet. */
export function needsAlert(guard: FeedPriceGuard, soldOut: boolean): boolean {
  return !!guard.hold && !guard.hold.alerted_at && !soldOut;
}

export const usd = (v: number): string => `$${Math.round(v).toLocaleString("en-US")}`;

/** The event's `campaign_skip_reason` while held - what /product-feed and the push button print. */
export function holdReasonText(hold: FeedPriceHold): string {
  const why =
    hold.reason === "ceiling"
      ? `מעל התקרה ${usd(FEED_PRICE_CEILING_USD)}`
      : `הכרטיס הזול ${usd(hold.ticket_usd ?? 0)} במקום ~${usd(hold.baseline_usd ?? 0)}`;
  return `${FEED_PRICE_HOLD_PREFIX} - מחוץ לפיד: ${usd(hold.card_usd)} לנוסע (${why}). לסמן Sold, או "המחיר נכון" בעורך האירוע`.slice(0, 300);
}

/**
 * Was this daily snapshot a spike? For the price-drop tag: a spike day is never the "before" of a
 * drop (918 back at $1,909 would otherwise read an $18,000 drop). `before` = the cheapest ticket of
 * the days before it.
 */
export function isSpikeSnapshot(
  row: { package_usd: number | null; min_ticket: number | null },
  before: number[],
): boolean {
  if (row.package_usd != null && row.package_usd > FEED_PRICE_CEILING_USD) return true;
  return isJump(row.min_ticket, priceBaseline(before));
}
