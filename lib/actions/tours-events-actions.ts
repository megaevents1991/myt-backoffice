"use server";

/**
 * Website > Mega Events Packages: what the active tours company's site shows of Mega Events (19.10.2026,
 * Dor: "שליטה מלאה... כולל סינכרון ידני ולא רק cron, וגם אופציה לבחירה ידנית").
 *
 * The screen edits the company's control document (tours.site_content 'events_control',
 * lib/tours/events-control.ts) and shows the list the site holds now (its 'events_feed'). Save stores
 * the control and runs the sync for this company at once; "Sync now" runs it without a change (fresh
 * prices, events that sold out). The sync rebuilds the site only when the list or the search changed.
 */
import { revalidatePath } from "next/cache";

import { requireCompany, type Company } from "@/lib/company";
import { logAudit } from "@/lib/audit";
import { supabase } from "@/lib/supabase-server";
import { toursDb } from "@/lib/tours/db";
import { actionFail, plainFail, type ActionResult } from "@/lib/tours/action-kit";
import { asObject, companyAudit, invalidInput, siteDeployHookOf } from "@/lib/tours/company-kit";
import {
  EVENTS_FEED_KEY,
  eventImageUrl,
  feedCategory,
  feedCutoffDate,
  feedDateLabel,
  isListedFeedEvent,
  storedFeedItems,
  storedFeedIndex,
  type EventsFeedCategory,
  type EventsFeedItem,
  type FeedEventRow,
} from "@/lib/tours/events-feed";
import { EVENTS_CONTROL_KEY, eventsControlSchema, readEventsControl, type EventsControl } from "@/lib/tours/events-control";
import { placeLabel } from "@/lib/lodging";
import { eventSiteUrl } from "@/lib/site";
import { syncToursEventsFeed, type ToursEventsFeedResult } from "@/lib/services/tours-events-feed-sync";
import type { Json } from "@/types/database.types";

const SCOPE = "tours-events-actions";

// events.deactivated_reason predates the generated DB types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const SAVED_BY_OTHER =
  "Someone else saved this screen while you were editing. Copy what you changed, reload the page, and apply it again.";

/** One Mega Events event as the screen lists it (a pick, a hidden one, a search result). */
export interface MegaEventRef {
  id: number;
  name: string;
  /** "DD/MM/YY". */
  dateLabel: string;
  place: string;
  category: EventsFeedCategory;
  image: string | null;
  /** Its order page on mega-events.co.il. */
  href: string;
  /** Mega Events sells it now: listed (not deleted, not taken off, more than 3 days ahead) and not tagged sold out. */
  onSale: boolean;
  /** Why it is not on sale, when it is not. */
  note?: string;
}

/** What the site holds now: the list the sync wrote last. */
export interface EventsFeedState {
  updatedAt: string | null;
  updatedBy: string | null;
  /** "site" = built from Mega Events' own rows; "database" = rebuilt from the event rows. */
  source: string | null;
  items: EventsFeedItem[];
  /** Events the site's search lists. */
  indexed: number;
  search: boolean;
}

export interface EventsScreenData {
  control: EventsControl;
  /** The control's version: a save must name it. Null = the company never saved the screen. */
  updatedAt: string | null;
  updatedBy: string | null;
  feed: EventsFeedState;
  /** The picks and the hidden events by id (an id Mega Events no longer has is missing). */
  events: Record<number, MegaEventRef>;
  siteUrl: string | null;
  /** The site can be rebuilt from here (a deploy hook is set in Settings). */
  deployable: boolean;
}

/** What one run of the sync did for this company, said on the screen. */
export interface EventsSyncReport {
  changed: boolean;
  items: number;
  indexed: number;
  /** "site" / "database" / "kept" (kept = nothing built). */
  source: ToursEventsFeedResult["source"];
  deploy: { ok: boolean; status: number | null; error?: string } | null;
  error?: string;
  siteError?: string;
}

const EVENT_COLUMNS = "id,name,date,type,location,event_location,card_image_url,art_image_url,tags,is_deleted,is_test,deactivated_reason";

type EventRow = Pick<
  FeedEventRow,
  "id" | "name" | "date" | "type" | "location" | "event_location" | "card_image_url" | "art_image_url" | "tags" | "is_deleted" | "is_test" | "deactivated_reason"
>;

function eventRefOf(e: EventRow, cutoff: string): MegaEventRef {
  const listed = isListedFeedEvent(e, cutoff);
  const sold = e.tags === "Sold";
  const lodging = e.location ? { location: e.location, event_location: e.event_location ?? null } : null;
  return {
    id: e.id,
    name: (e.name ?? "").trim() || `Event ${e.id}`,
    dateLabel: feedDateLabel(e.date) ?? "",
    place: placeLabel(lodging),
    category: feedCategory(e),
    image: eventImageUrl(e),
    href: eventSiteUrl(e.id),
    onSale: listed && !sold,
    ...(!listed
      ? { note: e.is_deleted != null ? "Deleted on Mega Events" : "Not sold any more (taken off, or less than 3 days away)" }
      : sold
        ? { note: "Sold out" }
        : {}),
  };
}

async function eventRefs(ids: number[]): Promise<Record<number, MegaEventRef>> {
  const out: Record<number, MegaEventRef> = {};
  if (ids.length === 0) return out;
  const cutoff = feedCutoffDate(new Date());
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from("events").select(EVENT_COLUMNS).in("id", ids.slice(i, i + 200));
    if (error) throw error;
    for (const row of (data ?? []) as EventRow[]) out[row.id] = eventRefOf(row, cutoff);
  }
  return out;
}

async function docRow(company: Company, key: string) {
  const { data, error } = await toursDb()
    .from("site_content")
    .select("data, updated_at, updated_by")
    .eq("company_id", company.id)
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function companyFeatures(company: Company) {
  const { data, error } = await db.from("companies").select("features").eq("id", company.id).single();
  if (error) throw error;
  return asObject((data?.features ?? null) as Json | null);
}

async function screenData(company: Company): Promise<EventsScreenData> {
  const [controlRow, feedRow, features] = await Promise.all([
    docRow(company, EVENTS_CONTROL_KEY),
    docRow(company, EVENTS_FEED_KEY),
    companyFeatures(company),
  ]);
  const control = readEventsControl(controlRow?.data ?? null);
  const feedData = asObject((feedRow?.data ?? null) as Json | null);
  const items = (storedFeedItems(feedRow?.data ?? null) ?? []) as EventsFeedItem[];
  return {
    control,
    updatedAt: controlRow?.updated_at ?? null,
    updatedBy: controlRow?.updated_by ?? null,
    feed: {
      updatedAt: typeof feedData.updatedAt === "string" ? feedData.updatedAt : (feedRow?.updated_at ?? null),
      updatedBy: feedRow?.updated_by ?? null,
      source: typeof feedData.source === "string" ? feedData.source : null,
      items,
      indexed: storedFeedIndex(feedRow?.data ?? null)?.length ?? 0,
      search: feedData.search !== false,
    },
    events: await eventRefs(Array.from(new Set([...control.picks, ...control.hidden]))),
    siteUrl: company.siteUrl,
    deployable: siteDeployHookOf(features) !== null,
  };
}

/** The screen: the company's control, the list its site holds now, and the events it names. */
export async function getEventsScreen(): Promise<ActionResult<EventsScreenData>> {
  try {
    const { company } = await requireCompany("tours");
    return { success: true, data: await screenData(company) };
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to load the Mega Events packages");
  }
}

/**
 * Mega Events' events on sale whose name (Hebrew or English) holds `query`, or whose id it is, soonest
 * first - what staff pin from. Read with the service client: the event tables belong to Mega Events,
 * and a tours member only reads names, dates and pictures here.
 */
export async function searchMegaEvents(query: string): Promise<ActionResult<MegaEventRef[]>> {
  try {
    await requireCompany("tours");
    // PostgREST's or() splits on commas and parentheses; a wildcard of the user's would widen the match
    const q = String(query ?? "")
      .replace(/[,()%*]/g, " ")
      .trim()
      .slice(0, 80);
    if (q.length < 2) return { success: true, data: [] };
    const cutoff = feedCutoffDate(new Date());
    const asId = /^\d+$/.test(q) ? Number(q) : null;
    const filter = [`name.ilike.%${q}%`, `name_english.ilike.%${q}%`, ...(asId ? [`id.eq.${asId}`] : [])].join(",");
    const { data, error } = await db
      .from("events")
      .select(EVENT_COLUMNS)
      .is("is_deleted", null)
      .gte("date", cutoff)
      .or(filter)
      .order("date", { ascending: true })
      .limit(30);
    if (error) throw error;
    return { success: true, data: ((data ?? []) as EventRow[]).map((row) => eventRefOf(row, cutoff)) };
  } catch (e) {
    return actionFail(e, SCOPE, "The search failed");
  }
}

function reportOf(result: ToursEventsFeedResult): EventsSyncReport {
  const mine = result.companies[0];
  if (!mine) {
    return {
      changed: false,
      items: 0,
      indexed: 0,
      source: result.source,
      deploy: null,
      error: "This company does not show Mega Events packages (switched off in its settings).",
    };
  }
  return {
    changed: mine.changed,
    items: mine.items,
    indexed: mine.indexed,
    source: result.source,
    deploy: mine.deploy,
    ...(mine.error ? { error: mine.error } : {}),
    ...(result.siteError ? { siteError: result.siteError } : {}),
  };
}

/** The sync for this company alone, on staff's word: built even when Mega Events' site cannot be read. */
async function syncCompany(company: Company, email: string): Promise<EventsSyncReport> {
  const result = await syncToursEventsFeed(new Date(), { companyId: company.id, force: true, by: email });
  return reportOf(result);
}

/**
 * Saves the control and brings the site's list up to it at once. `expectedUpdatedAt` is the version the
 * screen loaded (null when the company had none yet); a save over a newer version is refused.
 */
export async function saveEventsControl(
  form: unknown,
  expectedUpdatedAt: string | null,
): Promise<ActionResult<{ screen: EventsScreenData; sync: EventsSyncReport }>> {
  try {
    const { company, session } = await requireCompany("tours");
    const parsed = eventsControlSchema.safeParse(form);
    if (!parsed.success) return invalidInput(parsed.error);
    const data = parsed.data as unknown as Json;

    const before = await docRow(company, EVENTS_CONTROL_KEY);
    if ((before?.updated_at ?? null) !== expectedUpdatedAt) return plainFail(SAVED_BY_OTHER);
    const stamp = { data, updated_at: new Date().toISOString(), updated_by: session.email };
    if (before) {
      // the version is part of the condition, so two saves at the same moment cannot both win
      const { data: written, error } = await toursDb()
        .from("site_content")
        .update(stamp)
        .eq("company_id", company.id)
        .eq("key", EVENTS_CONTROL_KEY)
        .eq("updated_at", before.updated_at)
        .select("key")
        .maybeSingle();
      if (error) throw error;
      if (!written) return plainFail(SAVED_BY_OTHER);
    } else {
      const { error } = await toursDb().from("site_content").insert({ company_id: company.id, key: EVENTS_CONTROL_KEY, ...stamp });
      if (error) {
        if (error.code === "23505") return plainFail(SAVED_BY_OTHER);
        throw error;
      }
    }
    await logAudit({
      action: before ? "update" : "create",
      entityType: "tours_site_content",
      entityId: EVENTS_CONTROL_KEY,
      metadata: { ...companyAudit(company), key: EVENTS_CONTROL_KEY, control: data },
    });

    const sync = await syncCompany(company, session.email);
    revalidatePath("/tours/events");
    return { success: true, data: { screen: await screenData(company), sync } };
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to save");
  }
}

/** "Sync now": the list built again from Mega Events as it is now, and the site rebuilt if it changed. */
export async function syncEventsNow(): Promise<ActionResult<{ screen: EventsScreenData; sync: EventsSyncReport }>> {
  try {
    const { company, session } = await requireCompany("tours");
    const sync = await syncCompany(company, session.email);
    await logAudit({
      action: "sync",
      entityType: "tours_site_content",
      entityId: EVENTS_FEED_KEY,
      metadata: { ...companyAudit(company), changed: sync.changed, items: sync.items, error: sync.error ?? null },
    });
    revalidatePath("/tours/events");
    return { success: true, data: { screen: await screenData(company), sync } };
  } catch (e) {
    return actionFail(e, SCOPE, "The sync failed");
  }
}
