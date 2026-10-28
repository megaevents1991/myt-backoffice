/**
 * Landing pages -> the events they sell -> our Paid orders of those events (lib/marketing/page-subject.ts says why).
 * Shared by the Traffic tab's landing table and the page alerts. Session-free; the callers guard. Throws on a read
 * error - a page "with no sales" because a read failed would raise a false alert.
 */
import { mdb, readAll } from "@/lib/services/marketing-db";
import { normalizePage, pageSold, pageSubject } from "@/lib/marketing/page-subject";
import type { SalesView } from "@/lib/marketing/sales";

/** Event ids per page, keyed by the page as handed in. A page with no subject (or a category with no tags) is absent. */
export async function pageEventSets(pages: string[]): Promise<Map<string, Set<number>>> {
  const out = new Map<string, Set<number>>();
  const categoryPages = new Map<string, string[]>(); // normalized /c/ path -> the pages as handed in
  for (const page of pages) {
    const s = pageSubject(page);
    if (s?.kind === "event") out.set(page, new Set([s.eventId]));
    if (s?.kind === "category") categoryPages.set(s.path, [...(categoryPages.get(s.path) ?? []), page]);
  }
  if (categoryPages.size === 0) return out;

  // A category's own /c/ address is its `link_url` (kept so by the Templates screen) - 139 rows on 28.10.
  const { data: cats, error: catError } = await mdb.from("categories").select("id, link_url").not("link_url", "is", null).limit(1000);
  if (catError) throw new Error(`categories read: ${catError.message}`);
  const catByPath = new Map<string, number>();
  for (const c of (cats ?? []) as { id: number; link_url: string }[]) catByPath.set(normalizePage(c.link_url), c.id);
  const catIds = [...new Set([...categoryPages.keys()].map((p) => catByPath.get(p)).filter((id): id is number => id !== undefined))];
  if (catIds.length === 0) return out;

  const { data: ct, error: ctError } = await mdb.from("category_tags").select("category_id, tag_id").in("category_id", catIds).limit(1000);
  if (ctError) throw new Error(`category_tags read: ${ctError.message}`);
  const tagsByCat = new Map<number, number[]>();
  for (const r of (ct ?? []) as { category_id: number; tag_id: number }[]) tagsByCat.set(r.category_id, [...(tagsByCat.get(r.category_id) ?? []), r.tag_id]);
  const tagIds = [...new Set([...tagsByCat.values()].flat())];
  if (tagIds.length === 0) return out;

  const links = await readAll<{ event_id: number; tag_id: number }>("event_tag_links", "event_id, tag_id", ["tag_id", "event_id"], 50_000, "pages", (q) => q.in("tag_id", tagIds));
  const eventsByTag = new Map<number, number[]>();
  for (const l of links) eventsByTag.set(l.tag_id, [...(eventsByTag.get(l.tag_id) ?? []), l.event_id]);

  for (const [path, handed] of categoryPages) {
    const catId = catByPath.get(path);
    if (catId === undefined) continue;
    const events = new Set((tagsByCat.get(catId) ?? []).flatMap((t) => eventsByTag.get(t) ?? []));
    if (events.size) for (const page of handed) out.set(page, events);
  }
  return out;
}

/** Sold / previously sold per page out of a Sales view of the same window; null = the page sells nothing of its own. */
export async function pageSales(pages: string[], sales: Pick<SalesView, "eventOrders">): Promise<Map<string, { sold: number; prevSold: number } | null>> {
  const sets = await pageEventSets(pages);
  const eventOrders = new Map(sales.eventOrders.map((e) => [e.eventId, { orders: e.orders, prevOrders: e.prevOrders }]));
  return new Map(pages.map((p) => [p, pageSold(sets.get(p), eventOrders)]));
}
