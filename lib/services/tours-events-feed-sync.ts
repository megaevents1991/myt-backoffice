/**
 * Keeps the Mega Events packages a tours company site shows (lib/tours/events-feed.ts) fresh:
 * builds the list, stores it in tours.site_content (key 'events_feed') of every tours company,
 * and - only when the list changed - rebuilds that company's site through its deploy hook, the
 * same POST as "Publish to site". Run by /api/cron/toursEventsFeed. Server-only (service role).
 *
 * Every database call has a deadline and every step logs its duration ("[toursEventsFeed] <step>
 * <ms>ms"): on 14.10.2026 the run hung until Vercel killed it at 60 s, and nothing said where.
 */
import { supabase, supabaseTyped } from "@/lib/supabase-server";
import { toursDb } from "@/lib/tours/db";
import { MEGA_EVENTS_COMPANY_ID } from "@/lib/company-ids";
import {
  LAST_SITE_PUBLISH_KEY,
  asObject,
  postSiteDeployHook,
  siteDeployHookOf,
} from "@/lib/tours/company-kit";
import type { RowRef, ShowFlags } from "@/lib/homepage/merge";
import {
  EVENTS_FEED_KEY,
  FEED_ORDER_COLUMNS,
  HOT_ROW_KEY,
  buildEventsFeedInPages,
  feedCutoffDate,
  hotRowHidden,
  hotRowPins,
  sameFeedItems,
  storedFeedItems,
  type EventsFeedDoc,
  type FeedEventRow,
  type FeedOrderRow,
  type SiteHotRow,
} from "@/lib/tours/events-feed";
import type { Json } from "@/types/database.types";

// homepage_* tables and events.deactivated_reason predate the generated DB types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Who the stored row and the publish record name. */
const UPDATED_BY = "cron: Mega Events packages";

/**
 * The longest one database call may take. supabase-js has no timeout of its own, so a call that
 * never answers would otherwise hold the run until Vercel kills it, with nothing logged.
 */
const DB_TIMEOUT_MS = 20_000;
const deadline = () => AbortSignal.timeout(DB_TIMEOUT_MS);

/** Runs one step of the sync and logs how long it took, so a run that fails says where. */
async function step<T>(name: string, run: () => Promise<T>, detail?: (result: T) => string): Promise<T> {
  const started = Date.now();
  try {
    const result = await run();
    console.log(`[toursEventsFeed] ${name} ${Date.now() - started}ms${detail ? ` ${detail(result)}` : ""}`);
    return result;
  } catch (error) {
    console.log(`[toursEventsFeed] ${name} ${Date.now() - started}ms failed`);
    throw error;
  }
}

/** What orders the list - read for every listed event. */
const ORDER_COLUMNS = FEED_ORDER_COLUMNS.join(",");

/**
 * What the list prints and prices: the card fields + everything siteCardPrice reads
 * (lib/package-price.ts). Heavy (tickets_and_rates), so it is read only for the events the list
 * can reach, a page at a time (buildEventsFeedInPages).
 */
const EVENT_COLUMNS = [
  "id,name,type,date,location,event_location,card_image_url,art_image_url,tags,is_prioritized,is_test",
  "deactivated_reason,is_deleted,tickets_and_rates,base_flight_price,base_hotel_price,event_additional_markup",
  "markup_ticket,markup_flight,markup_hotel,package_mode,ticket_only_markup",
  "ready_package_token,ready_package_mode,ready_package_price_usd",
].join(",");

export type CompanyFeedResult = {
  slug: string;
  changed: boolean;
  /** The deploy hook's answer; null = not called (nothing changed, or no hook set). */
  deploy: { ok: boolean; status: number | null; error?: string } | null;
  error?: string;
};

export type ToursEventsFeedResult = {
  /** "site" = the site's own row; "database" = rebuilt from the rows; "kept" = nothing built. */
  source: "site" | "database" | "kept";
  items: number;
  /** Why the site's row could not be used. */
  siteError?: string;
  companies: CompanyFeedResult[];
};

type FeedCompany = { id: string; slug: string };

/** The tours companies that show the list: active, selling tours, and not switched off (features.events_feed = false). */
async function feedCompanies(): Promise<FeedCompany[]> {
  const { data, error } = await supabaseTyped
    .from("companies")
    .select("id, slug, features, product_types")
    .eq("is_active", true)
    .contains("product_types", ["tours"])
    .abortSignal(deadline());
  if (error) throw new Error(`companies read: ${error.message}`);
  return (data ?? [])
    .filter((c) => c.id !== MEGA_EVENTS_COMPANY_ID && asObject(c.features).events_feed !== false)
    .map((c) => ({ id: c.id, slug: c.slug }));
}

/** Pins and hidden cards of "המבוקשים ביותר". Unreadable = none, the way the site falls back. */
async function readHotRowLayout(): Promise<{ pins: ReturnType<typeof hotRowPins>; hidden: RowRef[] }> {
  try {
    const [section, items] = await Promise.all([
      db.from("homepage_sections").select("config").eq("key", HOT_ROW_KEY).abortSignal(deadline()).maybeSingle(),
      db
        .from("homepage_items")
        .select("section,kind,ref_id,position")
        .eq("section", HOT_ROW_KEY)
        .abortSignal(deadline()),
    ]);
    if (section.error) throw section.error;
    if (items.error) throw items.error;
    return { pins: hotRowPins(items.data ?? []), hidden: hotRowHidden(section.data?.config) };
  } catch (error) {
    console.error("[toursEventsFeed] homepage layout unreadable - no pins:", error);
    return { pins: [], hidden: [] };
  }
}

/**
 * The row's pool and card flags from the site (myt-main /api/homepage-pools - the /homepage board
 * reads the same), or why not.
 */
async function readSiteHotRow(): Promise<{ row: SiteHotRow } | { error: string }> {
  const base = process.env.NEXT_SECRET_HOTEL_SERVICE_URL;
  const secret = process.env.NEXT_SECRET_REVALIDATION_SECRET;
  if (!base || !secret) return { error: "the site's address or shared secret is not set" };
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/api/homepage-pools`, {
      headers: { "x-hotel-secret": secret },
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return { error: `the site answered ${res.status}` };
    const body = (await res.json()) as { pools?: Record<string, unknown>; cards?: unknown };
    const pool = body?.pools?.[HOT_ROW_KEY];
    if (!Array.isArray(pool) || !Array.isArray(body.cards)) return { error: "the site's answer was not understood" };
    const flags = new Map<RowRef, ShowFlags>();
    for (const card of body.cards as { ref?: unknown; soldOut?: unknown; available?: unknown }[]) {
      if (typeof card?.ref !== "string") continue;
      flags.set(card.ref, { soldOut: card.soldOut === true, available: card.available === true });
    }
    return { row: { pool: pool.filter((r): r is string => typeof r === "string"), flags } };
  } catch (error) {
    console.error("[toursEventsFeed] homepage pools:", error);
    return { error: "the site could not be reached" };
  }
}

/**
 * Every event a Mega Events listing may show (myt-main lib/eventsData.ts getEvents), light
 * columns only. Until 14.10.2026 this read took the tickets of all of them too (~7 MB) and the
 * run timed out.
 */
async function readEventOrder(now: Date): Promise<FeedOrderRow[]> {
  const { data, error } = await db
    .from("events")
    .select(ORDER_COLUMNS)
    .is("is_deleted", null)
    .gte("date", feedCutoffDate(now))
    .order("date", { ascending: true })
    .limit(2000)
    .abortSignal(deadline());
  if (error) throw new Error(`events read: ${error.message}`);
  return (data ?? []) as FeedOrderRow[];
}

/** The full rows (tickets and prices) of one page of the list's candidates. */
async function readFullEvents(ids: number[]): Promise<FeedEventRow[]> {
  const { data, error } = await db.from("events").select(EVENT_COLUMNS).in("id", ids).abortSignal(deadline());
  if (error) throw new Error(`events full read: ${error.message}`);
  return (data ?? []) as FeedEventRow[];
}

async function storedDoc(companyId: string): Promise<unknown[] | null> {
  const { data, error } = await toursDb()
    .from("site_content")
    .select("data")
    .eq("company_id", companyId)
    .eq("key", EVENTS_FEED_KEY)
    .abortSignal(deadline())
    .maybeSingle();
  if (error) throw new Error(`site_content read: ${error.message}`);
  return data ? storedFeedItems(data.data) : null;
}

/** POSTs the company's deploy hook and records the attempt as its last publish (what the Publish button shows). */
async function rebuildSite(companyId: string): Promise<CompanyFeedResult["deploy"]> {
  const read = async () => {
    const { data, error } = await supabaseTyped
      .from("companies")
      .select("features")
      .eq("id", companyId)
      .abortSignal(deadline())
      .single();
    if (error) throw new Error(`companies read: ${error.message}`);
    return asObject(data.features);
  };
  const hook = siteDeployHookOf(await read());
  if (!hook) return null;
  // its own 20 s deadline (company-kit.ts)
  const { status, problem } = await postSiteDeployHook(hook);
  const record = {
    at: new Date().toISOString(),
    by: UPDATED_BY,
    status,
    ok: !problem,
    ...(problem ? { error: problem } : {}),
  };
  // read again right before the write so a settings save in between is not lost
  const features = await read();
  const { error } = await supabaseTyped
    .from("companies")
    .update({ features: { ...features, [LAST_SITE_PUBLISH_KEY]: record } })
    .eq("id", companyId)
    .abortSignal(deadline());
  if (error) console.error("[toursEventsFeed] publish record not stored:", error.message);
  return { ok: !problem, status, ...(problem ? { error: problem } : {}) };
}

export async function syncToursEventsFeed(now = new Date()): Promise<ToursEventsFeedResult> {
  const companies = await step("companies", feedCompanies, (list) => `${list.length} to feed`);
  if (companies.length === 0) return { source: "kept", items: 0, companies: [] };

  const [layout, site, order, stored] = await Promise.all([
    step("homepage layout", readHotRowLayout, (l) => `${l.pins.length} pins, ${l.hidden.length} hidden`),
    step("site row", readSiteHotRow, (s) => ("row" in s ? `${s.row.pool.length} in the pool` : `unusable: ${s.error}`)),
    step("events order", () => readEventOrder(now), (rows) => `${rows.length} listed`),
    step("stored lists", () => Promise.all(companies.map((c) => storedDoc(c.id)))),
  ]);
  const siteRow = "row" in site ? site.row : null;
  const siteError = "error" in site ? site.error : undefined;

  // Without the site's row the order is rebuilt from the rows (fallbackPool), which is close but
  // not card-for-card - so a list already stored is kept until the site answers again, and only a
  // company with no list yet gets the rebuilt one.
  if (!siteRow && stored.every((items) => items !== null)) {
    const kept = companies.map((c) => ({ slug: c.slug, changed: false, deploy: null }));
    return { source: "kept", items: 0, siteError, companies: kept };
  }

  let page = 0;
  const readPage = (ids: number[]) =>
    step(`events page ${++page}`, () => readFullEvents(ids), (rows) => `${rows.length}/${ids.length} rows`);
  const plan = await step(
    "build",
    () => buildEventsFeedInPages({ order, pins: layout.pins, hidden: layout.hidden, site: siteRow, now }, readPage),
    (p) => `${p.items.length} items, ${p.read} events read in full${p.complete ? "" : " (not final)"}`,
  );
  const items = plan.items;
  const doc: EventsFeedDoc = { updatedAt: now.toISOString(), source: siteRow ? "site" : "database", items };

  const results: CompanyFeedResult[] = [];
  for (const [i, company] of companies.entries()) {
    const before = stored[i];
    try {
      if (before !== null && (!siteRow || sameFeedItems(before, items))) {
        results.push({ slug: company.slug, changed: false, deploy: null });
        continue;
      }
      // an empty list is a failed read upstream, never news (myt-main never caches an empty catalog either)
      if (items.length === 0) {
        const error = "built an empty list - nothing written";
        results.push({ slug: company.slug, changed: false, deploy: null, error });
        continue;
      }
      const row = {
        company_id: company.id,
        key: EVENTS_FEED_KEY,
        data: doc as unknown as Json,
        updated_at: doc.updatedAt,
        updated_by: UPDATED_BY,
      };
      await step(`${company.slug} write`, async () => {
        const { error } = await toursDb()
          .from("site_content")
          .upsert(row, { onConflict: "company_id,key" })
          .abortSignal(deadline());
        if (error) throw new Error(`site_content write: ${error.message}`);
      });
      const deploy = await step(
        `${company.slug} deploy`,
        () => rebuildSite(company.id),
        (d) => (d ? `${d.ok ? "ok" : "failed"} ${d.status ?? ""}`.trim() : "no deploy hook"),
      );
      results.push({ slug: company.slug, changed: true, deploy });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[toursEventsFeed]", company.slug, message);
      results.push({ slug: company.slug, changed: false, deploy: null, error: message });
    }
  }
  return { source: doc.source, items: items.length, ...(siteError ? { siteError } : {}), companies: results };
}
