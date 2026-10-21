/**
 * Spend guard (2026-10-21). Every sync re-reads the last 7 days from Meta / Google and upserts them over
 * what is stored - Meta restates recent days, so the re-read is right. On 21.10 Meta's insights answered
 * the 14-20.10 window with every adset-day of 14-19 at spend 0 / impressions 0 / clicks 0 (purchases
 * still attributed to those days) while 20 came back whole, and the upsert wrote six days of zeros over
 * six days of real spend - the Executive tab showed a hole and nothing said why.
 *
 * The rule: a platform answering NO DELIVERY AT ALL for a day we already hold delivery for is a bad answer,
 * not a restatement - that day's fetched rows are dropped and the stored rows stay; the step's note names
 * the days. A day stored at zero (today's first tick, a day never read) takes whatever comes, so a later
 * good answer always lands and the guard can never hold a recovery back. Day-level on purpose: one ad set
 * at zero beside others with spend is an ad set that did not run.
 *
 * Pure; scripts/marketing-spend-guard-selftest.ts.
 */

export interface DayDelivery {
  day: string;
  spend: number;
  impressions: number;
  clicks?: number;
}

const n = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Per-day totals of spend / impressions / clicks over rows (several ad sets a day). */
export function dayTotals(rows: readonly DayDelivery[]): Map<string, { spend: number; impressions: number; clicks: number }> {
  const out = new Map<string, { spend: number; impressions: number; clicks: number }>();
  for (const r of rows) {
    const t = out.get(r.day) ?? { spend: 0, impressions: 0, clicks: 0 };
    t.spend += n(r.spend);
    t.impressions += n(r.impressions);
    t.clicks += n(r.clicks);
    out.set(r.day, t);
  }
  return out;
}

/**
 * The fetched rows minus every day the platform answered with no delivery (spend, impressions and clicks all 0
 * across its rows) while the stored rows of that day hold some; `kept` lists those days, sorted.
 */
export function keepStoredDays<T extends DayDelivery>(fetched: readonly T[], stored: readonly DayDelivery[]): { rows: T[]; kept: string[] } {
  const got = dayTotals(fetched);
  const have = dayTotals(stored);
  const kept = new Set<string>();
  for (const [day, t] of got) {
    if (t.spend !== 0 || t.impressions !== 0 || t.clicks !== 0) continue;
    const s = have.get(day);
    if (s && (s.spend > 0 || s.impressions > 0)) kept.add(day);
  }
  return { rows: fetched.filter((r) => !kept.has(r.day)), kept: [...kept].sort() };
}

/** "2026-10-14..2026-10-19, 2026-10-21" - consecutive yyyy-mm-dd days collapse to a range. */
export function dayRangesLabel(days: readonly string[]): string {
  const sorted = [...new Set(days)].sort();
  const parts: string[] = [];
  let start: string | null = null;
  let prev: string | null = null;
  const next = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const flush = () => {
    if (start === null || prev === null) return;
    parts.push(start === prev ? start : `${start}..${prev}`);
  };
  for (const d of sorted) {
    if (prev !== null && next(prev) === d) {
      prev = d;
      continue;
    }
    flush();
    start = d;
    prev = d;
  }
  flush();
  return parts.join(", ");
}

/** The note a step appends when days were kept; "" when none. */
export function spendGuardNote(platform: string, kept: readonly string[]): string {
  if (!kept.length) return "";
  return `kept stored spend for ${dayRangesLabel(kept)} (${platform} answered no delivery for ${kept.length === 1 ? "a day" : `${kept.length} days`} we hold spend for)`;
}
