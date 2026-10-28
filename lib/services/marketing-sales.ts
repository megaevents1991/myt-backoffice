/**
 * The reads behind the Sales tab and the Executive tab's "Leaders" (spec 2026-10-28 section 1): the Paid orders of the
 * period AND of the previous period of the same length (one read - the two windows touch), each order's source (the
 * Executive funnel's rule, so the bar's source filter means the same thing), the events' current names and their
 * typed tags. Session-free; the callers guard. Throws on any read error - an empty breakdown would read as "nothing
 * sold". Cached per (window, source, currency) under the P&L tag (the sync and a settings save drop it).
 */
import { unstable_cache } from "next/cache";
import { mdb } from "@/lib/services/marketing-db";
import { fetchPaged } from "@/lib/supabase-paged";
import { readTouches, usdIlsOf } from "@/lib/services/marketing-purchases";
import { revenueUsd, type RevenueColumns } from "@/lib/services/reservation-pnl";
import { currentUsdIls } from "@/lib/services/marketing-fx";
import { MARKETING_TAG, MARKETING_TTL_S } from "@/lib/services/marketing-cache";
import { addDays, israelDayStartUtc, previousWindow } from "@/lib/marketing/range";
import { orderSourceOf, type SourceFilter } from "@/lib/marketing/order-source";
import { buildSales, splitOrder, type SaleEventInfo, type SaleLine, type SaleTag, type SalesView } from "@/lib/marketing/sales";
import type { MarketingCurrency } from "@/lib/services/marketing-pnl";
import { normalizeReservationEventOrderInfo } from "@/lib/utils";
import type { ReservationEventOrderInfo } from "@/types/reservation.types";

/** Paid orders read over both periods. Past it the read throws - narrow the range. */
const ORDERS_MAX = 10_000;
/** `event_tag_links` rows per event are ~5 (vertical, city, artist / team, league / genre): 50 events stay far
 *  under PostgREST's silent 1,000-row answer. */
const TAG_CHUNK = 50;
/** An id list travels in the URL. */
const EVENT_CHUNK = 200;
const TAG_TYPES = ["vertical", "artist", "team", "league", "genre"] as const;

type OrderRow = RevenueColumns & { id: number; created_at: string; event_id: number | null; aff_partner_tracking_code: string | null; event_order_info: ReservationEventOrderInfo | null };

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function readEvents(ids: number[]): Promise<Map<number, SaleEventInfo>> {
  const out = new Map<number, SaleEventInfo>();
  const answers = await Promise.all(chunks(ids, EVENT_CHUNK).map((chunk) => mdb.from("events").select("id, name, name_english, date").in("id", chunk)));
  for (const { data, error } of answers) {
    if (error) throw new Error(`events read: ${error.message}`);
    for (const e of (data ?? []) as { id: number; name: string | null; name_english: string | null; date: string | null }[]) {
      out.set(e.id, { name: (e.name ?? "").trim() || (e.name_english ?? "").trim(), nameEnglish: e.name_english, date: e.date ? String(e.date).slice(0, 10) : null });
    }
  }
  return out;
}

async function readTags(ids: number[]): Promise<Map<number, SaleTag[]>> {
  const out = new Map<number, SaleTag[]>();
  const answers = await Promise.all(
    chunks(ids, TAG_CHUNK).map((chunk) =>
      mdb.from("event_tag_links").select("event_id, event_tags!inner(type, slug, name, name_english)").in("event_id", chunk).in("event_tags.type", [...TAG_TYPES]),
    ),
  );
  for (const { data, error } of answers) {
    if (error) throw new Error(`event_tag_links read: ${error.message}`);
    const rows = (data ?? []) as { event_id: number; event_tags: { type: string; slug: string; name: string | null; name_english: string | null } | null }[];
    // A chunk answered in full would have been cut silently - say so rather than undercount.
    if (rows.length >= 1000) throw new Error("event_tag_links read: a chunk hit the 1,000-row answer - lower TAG_CHUNK");
    for (const r of rows) {
      if (!r.event_tags) continue;
      const list = out.get(r.event_id) ?? [];
      list.push({ type: r.event_tags.type, slug: r.event_tags.slug, name: (r.event_tags.name ?? "").trim(), nameEnglish: r.event_tags.name_english });
      out.set(r.event_id, list);
    }
  }
  return out;
}

export async function salesBreakdown(since: string, until: string, src: SourceFilter, currency: MarketingCurrency): Promise<SalesView & { since: string; until: string; prevSince: string; prevUntil: string }> {
  const prev = previousWindow(since, until);
  const { rows, truncated, error } = await fetchPaged<OrderRow>(
    () =>
      mdb
        .from("reservations")
        .select("id, created_at, status, user_shown_price, exchange_rate_usd_ils_100, agent_card_discount_ils, partner_settlement_method, event_id, aff_partner_tracking_code, event_order_info")
        .eq("status", "Paid")
        .is("is_deleted", null)
        .gte("created_at", israelDayStartUtc(prev.since))
        .lt("created_at", israelDayStartUtc(addDays(until, 1)))
        .order("id"),
    ORDERS_MAX,
  );
  if (error) throw new Error(`reservations read: ${error.message}`);
  if (truncated) throw new Error(`reservations read: more than ${ORDERS_MAX} Paid orders in ${prev.since}..${until} - narrow the range`);

  const [touches, usdIls] = await Promise.all([src === "all" ? Promise.resolve(null) : readTouches(rows.map((r) => r.id)), currency === "ils" ? currentUsdIls() : Promise.resolve(1)]);
  const currentFrom = Date.parse(israelDayStartUtc(since));
  const lines: SaleLine[] = [];
  for (const r of rows) {
    if (touches && orderSourceOf({ touches: touches.get(r.id) ?? [], partnerCode: r.aff_partner_tracking_code }) !== src) continue;
    const usd = revenueUsd(r) ?? 0;
    const revenue = currency === "usd" ? usd : usd * (usdIlsOf(r.exchange_rate_usd_ils_100) ?? usdIls);
    lines.push(...splitOrder({ id: r.id, current: Date.parse(r.created_at) >= currentFrom, eventId: r.event_id, revenue }, normalizeReservationEventOrderInfo(r.event_order_info)));
  }

  const ids = [...new Set(lines.map((l) => l.eventId).filter((id): id is number => id !== null))];
  const [events, tagsByEvent] = await Promise.all([readEvents(ids), readTags(ids)]);
  return { ...buildSales({ lines, tagsByEvent, events }), since, until, prevSince: prev.since, prevUntil: prev.until };
}

export const cachedSalesBreakdown = unstable_cache(salesBreakdown, ["marketing-sales-v1"], { tags: [MARKETING_TAG.pnl], revalidate: MARKETING_TTL_S.pnl });
