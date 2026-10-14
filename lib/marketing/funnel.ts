/**
 * The Executive funnel (spec 2026-10-14 section 3, the reference dashboard's FUNNEL / EFFICIENCY rows).
 * Pure; scripts/marketing-funnel-selftest.ts.
 *
 * Every order of the period, all sources (Dor, 14.10), narrowed by the source filter:
 *   Leads = orders entered (any status), Signups = the Paid ones, Passengers = tickets on the Paid ones.
 * Spend follows the filter too: Meta / Google = that platform's spend, partners / no UTM / other = none.
 * A ratio with a zero side is `null` ("—" on screen), never 0 or Infinity.
 */
import type { OrderSource, SourceFilter } from "@/lib/marketing/order-source";

export interface FunnelOrder {
  /** Israel calendar day the order was created. */
  day: string;
  paid: boolean;
  tickets: number;
  source: OrderSource;
}

/** Spend per day per platform, already in the screen's currency. */
export interface SpendDay {
  day: string;
  meta: number;
  google: number;
}

export interface FunnelDay {
  day: string;
  leads: number;
  signups: number;
  passengers: number;
  spendMeta: number;
  spendGoogle: number;
  spend: number;
}

export interface Funnel {
  leads: number;
  signups: number;
  passengers: number;
  spend: number;
  spendMeta: number;
  spendGoogle: number;
  costPerLead: number | null;
  costPerSignup: number | null;
  costPerPassenger: number | null;
  /** Percent. */
  leadToSignup: number | null;
  paxPerSignup: number | null;
  daily: FunnelDay[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const ratio = (a: number, b: number) => (a > 0 && b > 0 ? r2(a / b) : null);

export function buildFunnel(orders: FunnelOrder[], spendDaily: SpendDay[], days: string[], src: SourceFilter): Funnel {
  const byDay = new Map<string, FunnelDay>(days.map((day) => [day, { day, leads: 0, signups: 0, passengers: 0, spendMeta: 0, spendGoogle: 0, spend: 0 }]));
  const withMeta = src === "all" || src === "meta";
  const withGoogle = src === "all" || src === "google";
  for (const s of spendDaily) {
    const d = byDay.get(s.day);
    if (!d) continue;
    if (withMeta) d.spendMeta += s.meta;
    if (withGoogle) d.spendGoogle += s.google;
    d.spend = d.spendMeta + d.spendGoogle;
  }
  for (const o of orders) {
    if (src !== "all" && o.source !== src) continue;
    const d = byDay.get(o.day);
    if (!d) continue;
    d.leads += 1;
    if (o.paid) {
      d.signups += 1;
      d.passengers += o.tickets;
    }
  }
  const daily = [...byDay.values()].map((d) => ({ ...d, spendMeta: r2(d.spendMeta), spendGoogle: r2(d.spendGoogle), spend: r2(d.spend) }));
  const sum = (k: keyof Omit<FunnelDay, "day">) => daily.reduce((a, d) => a + d[k], 0);
  const leads = sum("leads");
  const signups = sum("signups");
  const passengers = sum("passengers");
  const spendMeta = r2(sum("spendMeta"));
  const spendGoogle = r2(sum("spendGoogle"));
  const spend = r2(spendMeta + spendGoogle);
  return {
    leads,
    signups,
    passengers,
    spend,
    spendMeta,
    spendGoogle,
    costPerLead: ratio(spend, leads),
    costPerSignup: ratio(spend, signups),
    costPerPassenger: ratio(spend, passengers),
    leadToSignup: leads > 0 ? r2((signups / leads) * 100) : null,
    paxPerSignup: ratio(passengers, signups),
    daily,
  };
}
