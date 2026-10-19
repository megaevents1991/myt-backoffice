/**
 * Keeps the Mega Events packages a tours company site shows (lib/tours/events-feed.ts) fresh:
 * builds the list and the search index of every listed event, stores both in tours.site_content
 * (key 'events_feed') of every tours company, and - only when the list or the index changed -
 * rebuilds that company's site through its deploy hook, the same POST as "Publish to site". Run
 * by /api/cron/toursEventsFeed. Server-only (service role).
 *
 * Every database call has a deadline and every step logs its duration ("[toursEventsFeed] <step>
 * <ms>ms"): on 14.10.2026 the run hung until Vercel killed it at 60 s, and nothing said where.
 *
 * Since 19.10.2026 every company's list follows its own control (lib/tours/events-control.ts,
 * Website > Mega Events Packages): its picks, the Mega Events rows it follows, what it hid, how many,
 * whether the search lists Mega Events. The screen's Save and "Sync now" run this same sync for
 * their company alone (`companyId`), building even when Mega Events' site cannot be read (`force`).
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
import { toRef, type RowPin, type RowRef, type ShowFlags } from "@/lib/homepage/merge";
import {
  EVENTS_FEED_KEY,
  EVENTS_FEED_PAGE,
  FEED_LIGHT_COLUMNS,
  HOT_ROW_KEY,
  NEWEST_ROW_KEY,
  buildEventsFeedInPages,
  buildEventsIndex,
  feedCutoffDate,
  hotRowHidden,
  rowPins,
  sameFeedItems,
  storedFeedIndex,
  storedFeedItems,
  type EventsFeedDoc,
  type EventsFeedItem,
  type EventsFeedRowKey,
  type FeedEventRow,
  type FeedLightRow,
} from "@/lib/tours/events-feed";
import {
  DEFAULT_EVENTS_CONTROL,
  EVENTS_CONTROL_KEY,
  composeEventsFeed,
  pickedFeedItems,
  readEventsControl,
  type EventsControl,
} from "@/lib/tours/events-control";
import type { Json } from "@/types/database.types";

// homepage_* tables and events.deactivated_reason predate the generated DB types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Who the stored row and the publish record name when the cron ran it. */
const UPDATED_BY = "cron: Mega Events packages";
/** Mega Events' rows a company list can follow. */
const ROWS: EventsFeedRowKey[] = [HOT_ROW_KEY, NEWEST_ROW_KEY];

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

/** What orders the list and what the search index prints - read for every listed event. No tickets. */
const LIGHT_COLUMNS = FEED_LIGHT_COLUMNS.join(",");

/**
 * What the list prints and prices: the card fields + everything siteCardPrice reads
 * (lib/package-price.ts). Heavy (tickets_and_rates), so it is read only for the events the list
 * can reach, a page at a time (buildEventsFeedInPages).
 */
const EVENT_COLUMNS = [
  "id,name,type,date,location,event_location,card_image_url,art_image_url,tags,is_prioritized,is_test,created_at",
  "deactivated_reason,is_deleted,tickets_and_rates,base_flight_price,base_hotel_price,event_additional_markup",
  "markup_ticket,markup_flight,markup_hotel,package_mode,ticket_only_markup",
  "ready_package_token,ready_package_mode,ready_package_price_usd",
].join(",");

export type CompanyFeedResult = {
  slug: string;
  changed: boolean;
  /** Packages on the company's list and events in its search, as this run built them (0 when kept). */
  items: number;
  indexed: number;
  /** The deploy hook's answer; null = not called (nothing changed, or no hook set). */
  deploy: { ok: boolean; status: number | null; error?: string } | null;
  error?: string;
};

export type ToursEventsFeedResult = {
  /** "site" = the site's own rows; "database" = rebuilt from the rows; "kept" = nothing built. */
  source: "site" | "database" | "kept";
  /** The first company's list and search (the cron's log line). */
  items: number;
  /** Events in the search index (0 = nothing built). */
  indexed: number;
  /** Why the site's rows could not be used. */
  siteError?: string;
  companies: CompanyFeedResult[];
};

export type SyncEventsFeedOptions = {
  /** One company only (its screen's Save / "Sync now"); every tours company when not said. */
  companyId?: string;
  /** Build from the event rows when Mega Events' site cannot be read, instead of keeping the stored lists. */
  force?: boolean;
  /** Who asked: the stored row and the publish record name them (the cron when not said). */
  by?: string;
};

type FeedCompany = { id: string; slug: string };

/**
 * The tours companies that show the list: active, selling tours, and not switched off
 * (features.events_feed = false) - or the one company asked for, under the same rule.
 */
async function feedCompanies(only?: string): Promise<FeedCompany[]> {
  let query = supabaseTyped
    .from("companies")
    .select("id, slug, features, product_types")
    .eq("is_active", true)
    .contains("product_types", ["tours"]);
  if (only) query = query.eq("id", only);
  const { data, error } = await query.abortSignal(deadline());
  if (error) throw new Error(`companies read: ${error.message}`);
  return (data ?? [])
    .filter((c) => c.id !== MEGA_EVENTS_COMPANY_ID && asObject(c.features).events_feed !== false)
    .map((c) => ({ id: c.id, slug: c.slug }));
}

/** Each company's control of its list; a company that never saved one gets the default. */
async function readControls(companies: FeedCompany[]): Promise<Map<string, EventsControl>> {
  const { data, error } = await toursDb()
    .from("site_content")
    .select("company_id, data")
    .eq("key", EVENTS_CONTROL_KEY)
    .in(
      "company_id",
      companies.map((c) => c.id),
    )
    .abortSignal(deadline());
  if (error) throw new Error(`events control read: ${error.message}`);
  const out = new Map<string, EventsControl>();
  for (const row of data ?? []) out.set(row.company_id, readEventsControl(row.data));
  return out;
}

type RowLayout = { pins: RowPin[]; hidden: RowRef[] };

/** Pins and hidden cards of Mega Events' rows ("המבוקשים ביותר", "החדשים"). Unreadable = none, the way the site falls back. */
async function readRowLayouts(): Promise<Record<EventsFeedRowKey, RowLayout>> {
  const none = (): Record<EventsFeedRowKey, RowLayout> => ({
    [HOT_ROW_KEY]: { pins: [], hidden: [] },
    [NEWEST_ROW_KEY]: { pins: [], hidden: [] },
  });
  try {
    const [sections, items] = await Promise.all([
      db.from("homepage_sections").select("key,config").in("key", ROWS).abortSignal(deadline()),
      db.from("homepage_items").select("section,kind,ref_id,position").in("section", ROWS).abortSignal(deadline()),
    ]);
    if (sections.error) throw sections.error;
    if (items.error) throw items.error;
    const out = none();
    for (const row of ROWS) {
      const config = ((sections.data ?? []) as { key: string; config: unknown }[]).find((s) => s.key === row)?.config;
      out[row] = { pins: rowPins(items.data ?? [], row), hidden: hotRowHidden(config) };
    }
    return out;
  } catch (error) {
    console.error("[toursEventsFeed] homepage layout unreadable - no pins:", error);
    return none();
  }
}

/** The site's own rows: each row's automatic pool, and the card flags (its sold-out test). */
type SitePools = { pools: Partial<Record<EventsFeedRowKey, RowRef[]>>; flags: ReadonlyMap<RowRef, ShowFlags> };

/**
 * The pools of "המבוקשים ביותר" and "החדשים" and the card flags from the site (myt-main
 * /api/homepage-pools - the /homepage board reads the same), or why not. "החדשים" may be missing (an
 * older site): it is then rebuilt from the rows (newestPool).
 */
async function readSitePools(): Promise<{ site: SitePools } | { error: string }> {
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
    const hot = body?.pools?.[HOT_ROW_KEY];
    if (!Array.isArray(hot) || !Array.isArray(body.cards)) return { error: "the site's answer was not understood" };
    const flags = new Map<RowRef, ShowFlags>();
    for (const card of body.cards as { ref?: unknown; soldOut?: unknown; available?: unknown }[]) {
      if (typeof card?.ref !== "string") continue;
      flags.set(card.ref, { soldOut: card.soldOut === true, available: card.available === true });
    }
    const pools: SitePools["pools"] = {};
    for (const row of ROWS) {
      const pool = body.pools?.[row];
      if (Array.isArray(pool)) pools[row] = pool.filter((r): r is string => typeof r === "string");
    }
    return { site: { pools, flags } };
  } catch (error) {
    console.error("[toursEventsFeed] homepage pools:", error);
    return { error: "the site could not be reached" };
  }
}

/**
 * Every event a Mega Events listing may show (myt-main lib/eventsData.ts getEvents), light
 * columns only - what orders the list and what the search index prints (name, place, pictures).
 * Until 14.10.2026 this read took the tickets of all of them too (~7 MB) and the run timed out.
 */
async function readEventOrder(now: Date): Promise<FeedLightRow[]> {
  const { data, error } = await db
    .from("events")
    .select(LIGHT_COLUMNS)
    .is("is_deleted", null)
    .gte("date", feedCutoffDate(now))
    .order("date", { ascending: true })
    .limit(2000)
    .abortSignal(deadline());
  if (error) throw new Error(`events read: ${error.message}`);
  return (data ?? []) as FeedLightRow[];
}

/** The full rows (tickets and prices) of one page of the list's candidates. */
async function readFullEvents(ids: number[]): Promise<FeedEventRow[]> {
  const { data, error } = await db.from("events").select(EVENT_COLUMNS).in("id", ids).abortSignal(deadline());
  if (error) throw new Error(`events full read: ${error.message}`);
  return (data ?? []) as FeedEventRow[];
}

/** A company's stored list, index and search switch; null = no list worth comparing with. */
type StoredFeed = { items: unknown[]; index: unknown[] | null; search: boolean } | null;

async function storedDoc(companyId: string): Promise<StoredFeed> {
  const { data, error } = await toursDb()
    .from("site_content")
    .select("data")
    .eq("company_id", companyId)
    .eq("key", EVENTS_FEED_KEY)
    .abortSignal(deadline())
    .maybeSingle();
  if (error) throw new Error(`site_content read: ${error.message}`);
  const items = data ? storedFeedItems(data.data) : null;
  if (!items) return null;
  const search = asObject(data?.data ?? null).search !== false;
  return { items, index: storedFeedIndex(data?.data), search };
}

/** POSTs the company's deploy hook and records the attempt as its last publish (what the Publish button shows). */
async function rebuildSite(companyId: string, by: string): Promise<CompanyFeedResult["deploy"]> {
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
    by,
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

export async function syncToursEventsFeed(now = new Date(), options: SyncEventsFeedOptions = {}): Promise<ToursEventsFeedResult> {
  const by = options.by ?? UPDATED_BY;
  const companies = await step("companies", () => feedCompanies(options.companyId), (list) => `${list.length} to feed`);
  if (companies.length === 0) return { source: "kept", items: 0, indexed: 0, companies: [] };

  const [layouts, site, order, stored, controls] = await Promise.all([
    step("homepage layout", readRowLayouts, (l) => ROWS.map((row) => `${row}: ${l[row].pins.length} pins, ${l[row].hidden.length} hidden`).join("; ")),
    step("site rows", readSitePools, (r) => ("site" in r ? ROWS.map((row) => `${row}: ${r.site.pools[row]?.length ?? "-"}`).join(", ") : `unusable: ${r.error}`)),
    step("events order", () => readEventOrder(now), (rows) => `${rows.length} listed`),
    step("stored lists", () => Promise.all(companies.map((c) => storedDoc(c.id)))),
    step("controls", () => readControls(companies), (map) => `${map.size} saved`),
  ]);
  const siteRows = "site" in site ? site.site : null;
  const siteError = "error" in site ? site.error : undefined;
  const flags = siteRows?.flags ?? null;

  // Without the site's rows the order is rebuilt from the rows (fallbackPool / newestPool), which is
  // close but not card-for-card - so a list already stored is kept until the site answers again, and
  // only a company with no list yet gets the rebuilt one. Its index is kept with it: without the
  // site's card flags the index could list sold-out events, and flip back on the next run (two
  // deploys). A run staff asked for (`force`) builds anyway.
  if (!siteRows && !options.force && stored.every((before) => before !== null)) {
    const kept = companies.map((c) => ({ slug: c.slug, changed: false, items: 0, indexed: 0, deploy: null }));
    return { source: "kept", items: 0, indexed: 0, siteError, companies: kept };
  }

  // the full rows (tickets and prices) read so far, shared by every company and row (null = gone)
  const read = new Map<number, FeedEventRow | null>();
  let page = 0;
  const readFull = async (ids: number[]): Promise<FeedEventRow[]> => {
    const fresh = Array.from(new Set(ids.filter((id) => !read.has(id))));
    for (let i = 0; i < fresh.length; i += EVENTS_FEED_PAGE) {
      const part = fresh.slice(i, i + EVENTS_FEED_PAGE);
      const rows = await step(`events page ${++page}`, () => readFullEvents(part), (got) => `${got.length}/${part.length} rows`);
      for (const id of part) read.set(id, null);
      for (const row of rows) read.set(row.id, row);
    }
    return ids.map((id) => read.get(id)).filter((row): row is FeedEventRow => !!row);
  };

  const source: EventsFeedDoc["source"] = siteRows ? "site" : "database";
  const results: CompanyFeedResult[] = [];
  for (const [i, company] of companies.entries()) {
    const before = stored[i];
    const control = controls.get(company.id) ?? DEFAULT_EVENTS_CONTROL;
    try {
      if (!siteRows && !options.force && before !== null) {
        results.push({ slug: company.slug, changed: false, items: 0, indexed: 0, deploy: null });
        continue;
      }
      const hidden = control.hidden.map((id) => toRef("event", id));
      const rows: Partial<Record<EventsFeedRowKey, EventsFeedItem[]>> = {};
      for (const row of control.auto) {
        const pool = siteRows?.pools[row];
        const plan = await step(
          `${company.slug} ${row}`,
          () =>
            buildEventsFeedInPages(
              {
                order,
                row,
                pins: layouts[row].pins,
                hidden: [...layouts[row].hidden, ...hidden],
                site: pool && siteRows ? { pool, flags: siteRows.flags } : null,
                now,
                max: control.max + control.picks.length,
              },
              readFull,
            ),
          (p) => `${p.items.length} items${p.complete ? "" : " (not final)"}`,
        );
        rows[row] = plan.items;
      }
      const picked = control.picks.length ? pickedFeedItems(await readFull(control.picks), now, flags) : new Map<number, EventsFeedItem>();
      const items = composeEventsFeed(control, picked, rows);
      // every listed event, from the first read alone (no tickets), the list's own prices on its events
      const index = control.search
        ? buildEventsIndex({ events: order, now, flags, read, priced: items }).filter((e) => !control.hidden.includes(e.id))
        : [];
      const doc: EventsFeedDoc = { updatedAt: now.toISOString(), source, items, index, search: control.search };

      // the index counts as a change too (a document without one - before 15.10.2026 - gets it now)
      const same =
        before !== null && sameFeedItems(before.items, items) && sameFeedItems(before.index, index) && before.search === control.search;
      if (same) {
        results.push({ slug: company.slug, changed: false, items: items.length, indexed: index.length, deploy: null });
        continue;
      }
      // an empty list is a failed read upstream, never news (myt-main never caches an empty catalog
      // either) - unless the company follows no Mega Events row and none of its picks can be sold
      if (items.length === 0 && control.auto.length > 0) {
        const error = "built an empty list - nothing written";
        results.push({ slug: company.slug, changed: false, items: 0, indexed: index.length, deploy: null, error });
        continue;
      }
      const row = {
        company_id: company.id,
        key: EVENTS_FEED_KEY,
        data: doc as unknown as Json,
        updated_at: doc.updatedAt,
        updated_by: by,
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
        () => rebuildSite(company.id, by),
        (d) => (d ? `${d.ok ? "ok" : "failed"} ${d.status ?? ""}`.trim() : "no deploy hook"),
      );
      results.push({ slug: company.slug, changed: true, items: items.length, indexed: index.length, deploy });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[toursEventsFeed]", company.slug, message);
      results.push({ slug: company.slug, changed: false, items: 0, indexed: 0, deploy: null, error: message });
    }
  }
  return {
    source,
    items: results[0]?.items ?? 0,
    indexed: results[0]?.indexed ?? 0,
    ...(siteError ? { siteError } : {}),
    companies: results,
  };
}
