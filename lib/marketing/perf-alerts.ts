/**
 * Pages and influencers that bring traffic and sell nothing (negative), and those that sell (positive) - spec
 * 2026-10-28 section 2. ONE rule per pair, used by the alerts (lib/services/marketing-alerts.ts, every sync) AND by the
 * badges on the Traffic and Influencers tabs, so a badge and an alert never disagree on what they mean. Pure;
 * scripts/marketing-sales-selftest.ts. Thresholds come from marketing_settings (Settings tab).
 *
 * A page = a GA4 landing page: its sessions are the sessions that STARTED on it (GA4); its sales are OUR Paid orders of
 * what it sells (lib/marketing/page-subject.ts - an event page its event, a category page its events; a page that sells
 * nothing of its own is never judged). An influencer = an affiliate partner: visitors are the distinct users its links brought
 * (`affiliates_tracking`, VISIT), orders the Paid bookings carrying its code - the Partners screen's own numbers.
 */
import { trendOf } from "@/lib/marketing/sales";
import type { MarketingAlertKind, MarketingSettings } from "@/types/marketing.types";

export type PerfFlag = "no_sales" | "selling";

/** A "selling" page needs at least this many Paid orders - one lucky sale on a quiet page is not a trend. */
export const HOT_MIN_SALES = 2;
/** New alerts per kind per run: the top ones. An alert already open stays open while its page / influencer still
 *  qualifies, even when it is no longer in the top - so two pages swapping places never re-mail. */
export const PERF_ALERTS_MAX = 3;

export interface AlertCandidate {
  kind: MarketingAlertKind;
  key: string;
  title: string;
  payload: Record<string, unknown>;
}

type PageSettings = Pick<MarketingSettings, "page_alert_days" | "page_min_sessions" | "page_hot_pct">;
type InfluencerSettings = Pick<MarketingSettings, "influencer_alert_days" | "influencer_min_visitors" | "influencer_hot_orders">;

/** Paid orders per 100 sessions, two decimals; null with no sessions or nothing the page sells. */
export const pageConversion = (sessions: number, sold: number | null): number | null => (sold !== null && sessions > 0 ? Math.round((sold / sessions) * 10_000) / 100 : null);

/** `sold` null = the page sells nothing of its own: never judged. */
export function pageFlag(p: { sessions: number; sold: number | null }, s: Pick<MarketingSettings, "page_min_sessions" | "page_hot_pct">): PerfFlag | null {
  if (p.sold === null || p.sessions < s.page_min_sessions) return null;
  if (p.sold === 0) return "no_sales";
  const conv = pageConversion(p.sessions, p.sold) ?? 0;
  return p.sold >= HOT_MIN_SALES && conv >= s.page_hot_pct ? "selling" : null;
}

export function influencerFlag(r: { visitors: number; paid: number }, s: Pick<MarketingSettings, "influencer_min_visitors" | "influencer_hot_orders">): PerfFlag | null {
  if (r.paid >= s.influencer_hot_orders) return "selling";
  if (r.paid === 0 && r.visitors >= s.influencer_min_visitors) return "no_sales";
  return null;
}

/** GA4 rows (landing page x event name -> sessions) -> sessions (+ GA4's own purchases) per page. "(not set)" is not a page. */
export function pageTotals(rows: { landingPage: string; eventName: string; sessions: number }[]): Map<string, { sessions: number; purchased: number }> {
  const out = new Map<string, { sessions: number; purchased: number }>();
  for (const r of rows) {
    const page = (r.landingPage ?? "").trim();
    if (!page || page === "(not set)") continue;
    const p = out.get(page) ?? { sessions: 0, purchased: 0 };
    if (r.eventName === "session_start") p.sessions += r.sessions;
    if (r.eventName === "purchase") p.purchased += r.sessions;
    out.set(page, p);
  }
  return out;
}

/** The candidates of one kind: the top `max` (by `rank`, highest first) plus every one already open that still
 *  qualifies. */
function pick<T>(kind: MarketingAlertKind, qualifying: T[], keyOf: (t: T) => string, rank: (t: T) => number, open: Set<string>, max: number): T[] {
  const sorted = [...qualifying].sort((a, b) => rank(b) - rank(a) || keyOf(a).localeCompare(keyOf(b)));
  const top = new Set(sorted.slice(0, max).map(keyOf));
  return sorted.filter((t) => top.has(keyOf(t)) || open.has(`${kind}:${keyOf(t)}`));
}

const trendText = (now: number, before: number, what: string, days: number): string => {
  const t = trendOf(now, before);
  if (t.dir === "new") return ` · new - none in the ${days} days before`;
  if (t.change === null || t.dir === "flat") return "";
  return ` · ${what} ${t.change > 0 ? "+" : ""}${t.change}% vs the ${days} days before`;
};

export interface PageAlertInput {
  page: string;
  sessions: number;
  prevSessions: number;
  /** Our Paid orders of what the page sells; null = it sells nothing of its own. */
  sold: number | null;
  prevSold: number | null;
}

export function pageAlertCandidates(input: {
  pages: PageAlertInput[];
  settings: PageSettings;
  /** Open alerts as "kind:key". */
  open: Set<string>;
  max?: number;
}): AlertCandidate[] {
  const { settings: s, open } = input;
  const max = input.max ?? PERF_ALERTS_MAX;
  const days = s.page_alert_days;
  const rows = input.pages.map((p) => ({ ...p, flag: pageFlag(p, s) }));
  const negative = pick("page_no_sales", rows.filter((r) => r.flag === "no_sales"), (r) => r.page, (r) => r.sessions, open, max);
  const positive = pick("page_converting", rows.filter((r) => r.flag === "selling"), (r) => r.page, (r) => pageConversion(r.sessions, r.sold) ?? 0, open, max);
  return [
    ...negative.map((r) => ({
      kind: "page_no_sales" as const,
      key: r.page,
      title: `${r.page}: ${r.sessions.toLocaleString("en-US")} sessions in ${days} days, no Paid order of what it sells${trendText(r.sessions, r.prevSessions, "sessions", days)}`,
      payload: { page: r.page, sessions: r.sessions, sold: 0, days, prev_sessions: r.prevSessions, prev_sold: r.prevSold ?? 0 },
    })),
    ...positive.map((r) => {
      const rate = pageConversion(r.sessions, r.sold);
      return {
        kind: "page_converting" as const,
        key: r.page,
        title: `${r.page}: ${r.sold} Paid orders against ${r.sessions.toLocaleString("en-US")} sessions (${rate}%) in ${days} days${trendText(r.sold ?? 0, r.prevSold ?? 0, "orders", days)}`,
        payload: { page: r.page, sessions: r.sessions, sold: r.sold, rate_pct: rate, days, prev_sessions: r.prevSessions, prev_sold: r.prevSold ?? 0 },
      };
    }),
  ];
}

export interface InfluencerAlertInput {
  code: string;
  name: string;
  visitors: number;
  paid: number;
  prevVisitors: number;
  prevPaid: number;
}

export function influencerAlertCandidates(input: { rows: InfluencerAlertInput[]; settings: InfluencerSettings; open: Set<string>; max?: number }): AlertCandidate[] {
  const { settings: s, open } = input;
  const max = input.max ?? PERF_ALERTS_MAX;
  const days = s.influencer_alert_days;
  const flagged = input.rows.map((r) => ({ ...r, flag: influencerFlag(r, s) }));
  const negative = pick("influencer_no_sales", flagged.filter((r) => r.flag === "no_sales"), (r) => r.code, (r) => r.visitors, open, max);
  const positive = pick("influencer_selling", flagged.filter((r) => r.flag === "selling"), (r) => r.code, (r) => r.paid, open, max);
  const who = (r: InfluencerAlertInput) => (r.name && r.name !== r.code ? `${r.name} (${r.code})` : r.code);
  return [
    ...negative.map((r) => ({
      kind: "influencer_no_sales" as const,
      key: r.code,
      title: `${who(r)}: ${r.visitors} visitors in ${days} days, no Paid order${trendText(r.visitors, r.prevVisitors, "visitors", days)}`,
      payload: { code: r.code, name: r.name, visitors: r.visitors, paid: 0, days, prev_visitors: r.prevVisitors, prev_paid: r.prevPaid },
    })),
    ...positive.map((r) => ({
      kind: "influencer_selling" as const,
      key: r.code,
      title: `${who(r)}: ${r.paid} Paid orders from ${r.visitors} visitors in ${days} days${trendText(r.paid, r.prevPaid, "orders", days)}`,
      payload: { code: r.code, name: r.name, visitors: r.visitors, paid: r.paid, days, prev_visitors: r.prevVisitors, prev_paid: r.prevPaid },
    })),
  ];
}
