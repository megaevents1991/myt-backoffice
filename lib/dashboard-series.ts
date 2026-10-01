/**
 * Daily series of the dashboard charts (components/dashboard/trend-chart.tsx):
 * the window a range preset covers, and rows counted per day. Shared by every
 * company's chart, so "Last 30 days" means the same thing everywhere.
 */

/** The window a range preset covers, ending now. Unknown ranges fall back to 30 days. */
export function seriesWindow(range?: string, now: Date = new Date()): { start: Date; end: Date } {
  const end = new Date(now);
  let start = new Date(now);
  switch (range) {
    case "7d":
      start.setDate(start.getDate() - 7);
      break;
    case "30d":
      start.setDate(start.getDate() - 30);
      break;
    case "90d":
      start.setDate(start.getDate() - 90);
      break;
    case "1y":
      start.setFullYear(start.getFullYear() - 1);
      break;
    case "ytd": {
      start = new Date(now.getFullYear(), 0, 1);
      break;
    }
    default:
      start.setDate(start.getDate() - 30);
  }
  return { start, end };
}

function toDateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** One point per day from start to end (days with no row are 0), oldest first. */
export function dailySeries(
  timestamps: readonly string[],
  start: Date,
  end: Date,
): { date: string; count: number }[] {
  const counts = new Map<string, number>();
  // Pre-seed days for continuity
  const cur = new Date(start);
  while (cur <= end) {
    counts.set(toDateKey(cur), 0);
    cur.setDate(cur.getDate() + 1);
  }
  for (const at of timestamps) {
    const key = toDateKey(new Date(at));
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, count]) => ({ date, count }));
}
