/**
 * The Traffic tab (spec 2026-10-14 section 7): GA4 rows -> cards, a per-day series by source, three entry funnels,
 * a sources table and the top landing pages. Pure; scripts/marketing-traffic-selftest.ts.
 *
 * Sessions / users / steps are GA4's; leads and signups are OUR orders (the same source rule as the Executive
 * funnel), so "conversion" = our Paid orders / GA4 sessions of the same source.
 * A landing page is classified by the Partners screen's own rule (`classifyEntry`), so "entered on an artist page"
 * means the same thing on both screens.
 */
import { classifyEntry } from "@/lib/partner-entry-funnels";
import { isMetaSource } from "@/lib/services/marketing-attribution";
import { ORDER_SOURCES, type OrderSource, type SourceFilter } from "@/lib/marketing/order-source";
import type { FunnelOrder } from "@/lib/marketing/funnel";

/** Report A: date x source x medium. `date` is GA4's yyyymmdd. */
export interface TrafficDailyRow { date: string; source: string; medium: string; sessions: number; users: number; engaged: number }
/** Report B: source x medium x landing page x event -> sessions in which that event fired. */
export interface TrafficStepRow { source: string; medium: string; landingPage: string; eventName: string; sessions: number }

/** The GA4 events report B asks for. */
export const TRAFFIC_EVENTS = ["session_start", "select_item", "add_to_cart", "view_cart", "begin_checkout", "generate_lead", "purchase"] as const;

export type StepKey = "visited" | "picked" | "flights" | "summary" | "confirmed" | "purchased";
export const STEP_LABEL: Record<StepKey, string> = {
  visited: "Visited",
  picked: "Picked an event",
  flights: "Searched flights",
  summary: "Order summary",
  confirmed: "Confirmed",
  purchased: "Purchased",
};
export const STEP_HINT: Record<StepKey, string> = {
  visited: "session started",
  picked: "clicked an event card",
  flights: "the flight search ran",
  summary: "reached the order summary",
  confirmed: "paid or asked for a call",
  purchased: "the confirmation page",
};
const STEP_EVENTS: Record<StepKey, string[]> = {
  visited: ["session_start"],
  picked: ["select_item"],
  flights: ["add_to_cart"],
  summary: ["view_cart"],
  confirmed: ["begin_checkout", "generate_lead"],
  purchased: ["purchase"],
};

export type EntryFunnelKind = "home" | "artist" | "event";
export interface TrafficStep { key: StepKey; sessions: number; pct: number | null }
export interface SourceMediumRow { sourceMedium: string; sessions: number; users: number; engaged: number; confirmed: number; purchased: number }
export interface SourceBucketRow extends Omit<SourceMediumRow, "sourceMedium"> { bucket: OrderSource; leads: number; signups: number; rows: SourceMediumRow[] }
export interface LandingRow { page: string; kind: ReturnType<typeof classifyEntry>; sessions: number; purchased: number }
export type DailyBuckets = { day: string } & Record<OrderSource, number>;

export interface TrafficView {
  sessions: number;
  users: number;
  engaged: number;
  engagementRate: number | null;
  leads: number;
  signups: number;
  conversion: number | null;
  daily: DailyBuckets[];
  funnels: Record<EntryFunnelKind, TrafficStep[]>;
  otherEntries: number;
  sources: SourceBucketRow[];
  landing: LandingRow[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (part: number, whole: number) => (whole > 0 ? r2((part / whole) * 100) : null);
const LANDING_MAX = 25;

export function trafficBucket(source: string, medium: string, partnerCodes: Set<string>): OrderSource {
  const s = (source ?? "").trim().toLowerCase();
  const m = (medium ?? "").trim().toLowerCase();
  if (isMetaSource(s) || /(^|\.)facebook\.com$/.test(s) || /(^|\.)instagram\.com$/.test(s)) return "meta";
  if (s === "google" && (m === "cpc" || m === "ppc" || m === "paid")) return "google";
  if (m === "influencer" || partnerCodes.has(s)) return "partners";
  if (s === "" || s === "(not set)" || s === "(data not available)" || (s === "(direct)" && (m === "(none)" || m === "(not set)" || m === ""))) return "no_utm";
  return "other";
}

const isoDay = (yyyymmdd: string) => (/^\d{8}$/.test(yyyymmdd) ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}` : yyyymmdd);
const emptyBuckets = () => Object.fromEntries(ORDER_SOURCES.map((b) => [b, 0])) as Record<OrderSource, number>;

export function buildTraffic(input: {
  daily: TrafficDailyRow[];
  steps: TrafficStepRow[];
  partnerCodes: Set<string>;
  src: SourceFilter;
  orders: FunnelOrder[];
  days: string[];
}): TrafficView {
  const { partnerCodes, src } = input;
  const bucketOf = (r: { source: string; medium: string }) => trafficBucket(r.source, r.medium, partnerCodes);
  const keep = (b: OrderSource) => src === "all" || b === src;
  const smKey = (r: { source: string; medium: string }) => `${r.source} / ${r.medium}`;

  // ---- totals, per day, per source/medium (report A)
  const byDay = new Map<string, DailyBuckets>(input.days.map((day) => [day, { day, ...emptyBuckets() }]));
  const sm = new Map<string, SourceMediumRow & { bucket: OrderSource }>();
  const smRow = (r: { source: string; medium: string }, bucket: OrderSource) => {
    const k = smKey(r);
    let row = sm.get(k);
    if (!row) { row = { sourceMedium: k, bucket, sessions: 0, users: 0, engaged: 0, confirmed: 0, purchased: 0 }; sm.set(k, row); }
    return row;
  };
  let sessions = 0;
  let users = 0;
  let engaged = 0;
  for (const r of input.daily) {
    const b = bucketOf(r);
    if (!keep(b)) continue;
    sessions += r.sessions;
    users += r.users;
    engaged += r.engaged;
    const d = byDay.get(isoDay(r.date));
    if (d) d[b] += r.sessions;
    const row = smRow(r, b);
    row.sessions += r.sessions;
    row.users += r.users;
    row.engaged += r.engaged;
  }

  // ---- steps per landing kind, landing pages, confirmed / purchased per source (report B)
  const stepSums: Record<EntryFunnelKind | "other", Record<string, number>> = { home: {}, artist: {}, event: {}, other: {} };
  const landing = new Map<string, LandingRow>();
  for (const r of input.steps) {
    const b = bucketOf(r);
    if (!keep(b)) continue;
    const kind = classifyEntry("VISIT", r.landingPage);
    stepSums[kind][r.eventName] = (stepSums[kind][r.eventName] ?? 0) + r.sessions;
    let l = landing.get(r.landingPage);
    if (!l) { l = { page: r.landingPage, kind, sessions: 0, purchased: 0 }; landing.set(r.landingPage, l); }
    if (r.eventName === "session_start") l.sessions += r.sessions;
    if (r.eventName === "purchase") l.purchased += r.sessions;
    const row = smRow(r, b);
    if (r.eventName === "begin_checkout" || r.eventName === "generate_lead") row.confirmed += r.sessions;
    if (r.eventName === "purchase") row.purchased += r.sessions;
  }
  const funnel = (kind: EntryFunnelKind): TrafficStep[] => {
    const keys: StepKey[] = kind === "event" ? ["visited", "flights", "summary", "confirmed", "purchased"] : ["visited", "picked", "flights", "summary", "confirmed", "purchased"];
    const sum = (k: StepKey) => STEP_EVENTS[k].reduce((a, e) => a + (stepSums[kind][e] ?? 0), 0);
    const visited = sum("visited");
    return keys.map((key) => ({ key, sessions: sum(key), pct: key === "visited" ? null : pct(sum(key), visited) }));
  };

  // ---- our orders by source
  const orderCount = new Map<OrderSource, { leads: number; signups: number }>();
  for (const o of input.orders) {
    if (!keep(o.source)) continue;
    const c = orderCount.get(o.source) ?? { leads: 0, signups: 0 };
    c.leads += 1;
    if (o.paid) c.signups += 1;
    orderCount.set(o.source, c);
  }
  const leads = [...orderCount.values()].reduce((a, c) => a + c.leads, 0);
  const signups = [...orderCount.values()].reduce((a, c) => a + c.signups, 0);

  const sources: SourceBucketRow[] = ORDER_SOURCES.filter(keep)
    .map((bucket) => {
      const rows: SourceMediumRow[] = [...sm.values()]
        .filter((r) => r.bucket === bucket)
        .map((r) => ({ sourceMedium: r.sourceMedium, sessions: r.sessions, users: r.users, engaged: r.engaged, confirmed: r.confirmed, purchased: r.purchased }))
        .sort((a, b) => b.sessions - a.sessions);
      const add = (k: "sessions" | "users" | "engaged" | "confirmed" | "purchased") => rows.reduce((a, r) => a + r[k], 0);
      const c = orderCount.get(bucket) ?? { leads: 0, signups: 0 };
      return { bucket, sessions: add("sessions"), users: add("users"), engaged: add("engaged"), confirmed: add("confirmed"), purchased: add("purchased"), leads: c.leads, signups: c.signups, rows };
    })
    .filter((s) => s.sessions > 0 || s.leads > 0)
    .sort((a, b) => b.sessions - a.sessions);

  return {
    sessions,
    users,
    engaged,
    engagementRate: pct(engaged, sessions),
    leads,
    signups,
    conversion: pct(signups, sessions),
    daily: [...byDay.values()],
    funnels: { home: funnel("home"), artist: funnel("artist"), event: funnel("event") },
    otherEntries: stepSums.other.session_start ?? 0,
    sources,
    landing: [...landing.values()].sort((a, b) => b.sessions - a.sessions).slice(0, LANDING_MAX),
  };
}
