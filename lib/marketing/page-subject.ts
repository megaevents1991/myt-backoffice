/**
 * What a landing page SELLS (spec 2026-10-28 section 2): an event page sells its event; a category page (`/c/...` -
 * a vertical, a league, an artist, a team) sells the events carrying the category's tags (`category_tags`, the same
 * OR rule the site's category pages use). Every other page (the homepage, the cancellation policy, the blog) sells
 * nothing of its own and is never judged "no sales". Pure; scripts/marketing-sales-selftest.ts.
 *
 * Why not GA4's purchases per landing page: they count only a purchase made in the SAME session that landed there,
 * and GA4 sees a fraction of our orders - 5 purchases in the week to 28.10 against ~30 Paid orders, and 974 sessions
 * on the Oasis page with "0 purchases" while Oasis sold 81 tickets that month. A page's sales are OUR Paid orders of
 * what it sells.
 */

export type PageSubject = { kind: "event"; eventId: number } | { kind: "category"; path: string };

/** "/c/Music/Artists/Oasis/?x=1#top" -> "/c/music/artists/oasis". */
export function normalizePage(path: string): string {
  let p = (path ?? "").trim();
  const cut = p.search(/[?#]/);
  if (cut >= 0) p = p.slice(0, cut);
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p.toLowerCase();
}

export function pageSubject(path: string): PageSubject | null {
  const p = normalizePage(path);
  const event = /^\/order\/(\d+)(?:\/|$)/.exec(p);
  if (event) return { kind: "event", eventId: Number(event[1]) };
  if (/^\/c\/[^/]/.test(p)) return { kind: "category", path: p };
  return null;
}

/** Our Paid orders of a page's events, now and in the previous period. Null = the page sells nothing of its own (or
 *  a category with no tags, like the artists hub). */
export function pageSold(events: Set<number> | undefined, eventOrders: Map<number, { orders: number; prevOrders: number }>): { sold: number; prevSold: number } | null {
  if (!events || events.size === 0) return null;
  let sold = 0;
  let prevSold = 0;
  for (const [id, o] of eventOrders) {
    if (!events.has(id)) continue;
    sold += o.orders;
    prevSold += o.prevOrders;
  }
  return { sold, prevSold };
}
