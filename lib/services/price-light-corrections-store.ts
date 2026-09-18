// Table access for staff corrections (competitor_listing_corrections). The rules - what is live,
// what wins, how a value is validated - are pure and live in price-light-corrections.ts.
import { supabase } from "@/lib/supabase-server";
import { multiCurrencyExchangeRateService } from "@/lib/services/ticket-price-sync";
import { LIVETICKETS_RETAIL_FACTOR, LIVETICKETS_RETAIL_OFFSET_USD } from "@/lib/services/price-light";
import type { CompetitorKey, Currency } from "@/types/price-light.types";
import type { CorrectionField, CorrectionReason, CorrectionSource, CorrectionValue, ListingCorrection } from "./price-light-corrections";

// The table postdates the generated DB types - one boundary cast (repo pattern).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const COLUMNS = "id,listing_id,event_id,competitor,field,original,value,reason,note,source,created_by,created_at,revoked_at";
const IN_CHUNK = 200;

/** PostgREST / Postgres "no such table" - the migration has not been applied here yet. */
function tableMissing(error: { code?: string; message?: string } | null): boolean {
  if (error?.code === "PGRST205" || error?.code === "42P01") return true;
  const message = error?.message ?? "";
  return /competitor_listing_corrections/.test(message) && /not find|does not exist/.test(message);
}
let missingWarned = false;

/**
 * Every un-revoked correction on these listings (liveness against the crawled value is the
 * caller's, via `liveCorrections`). A missing table reads as "no corrections" - the code ships
 * with the migration and must not break matching in the minutes between them. Any OTHER failure
 * throws: silently matching without the corrections would flip a fixed light back to its wrong
 * value and rewrite the match row with it.
 */
export async function loadCorrections(listingIds: number[]): Promise<ListingCorrection[]> {
  const ids = [...new Set(listingIds)];
  const out: ListingCorrection[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await db.from("competitor_listing_corrections").select(COLUMNS)
      .in("listing_id", ids.slice(i, i + IN_CHUNK)).is("revoked_at", null);
    if (error) {
      if (tableMissing(error)) {
        if (!missingWarned) { missingWarned = true; console.error("price-light corrections: table not migrated yet - continuing with none"); }
        return [];
      }
      console.error("price-light corrections: read failed", JSON.stringify(error));
      throw new Error(`corrections read: ${error.message}`);
    }
    out.push(...((data ?? []) as ListingCorrection[]));
  }
  return out;
}

/**
 * The "this listing is not our event" marks on ONE event. Read separately because such a listing
 * is no longer matched to the event, so nothing on the comparison leads back to it - without
 * this the mark could never be seen again, let alone undone. Same missing-table rule as above;
 * a failure here only hides the undo button, so it logs and returns none.
 */
export async function loadPairCorrections(eventId: number): Promise<ListingCorrection[]> {
  const { data, error } = await db.from("competitor_listing_corrections").select(COLUMNS)
    .eq("event_id", eventId).eq("field", "not_same_event").is("revoked_at", null);
  if (error) {
    if (!tableMissing(error)) console.error("price-light corrections: pair read failed", JSON.stringify(error));
    return [];
  }
  return (data ?? []) as ListingCorrection[];
}

/** A listing's price in USD the way its own crawler computes it (LiveTickets carries a retail factor). */
export function listingUsd(competitor: CompetitorKey, amount: number, currency: Currency): number {
  const usd = currency === "USD" ? amount : multiCurrencyExchangeRateService.convertToUSD(amount, currency);
  return competitor === "livetickets"
    ? Math.round(usd * LIVETICKETS_RETAIL_FACTOR + LIVETICKETS_RETAIL_OFFSET_USD)
    : Math.round(usd);
}

export interface NewCorrection {
  listing_id: number; event_id: number | null; competitor: CompetitorKey; field: CorrectionField;
  original: CorrectionValue; value: CorrectionValue; reason: CorrectionReason | null; note: string;
  source: CorrectionSource; created_by: string | null;
}

/** Replace, never stack: the previous live correction of the same field is revoked first (the
 *  partial unique index allows one un-revoked row per listing + field + event). */
export async function saveCorrection(row: NewCorrection): Promise<ListingCorrection> {
  const nowIso = new Date().toISOString();
  let revoke = db.from("competitor_listing_corrections")
    .update({ revoked_at: nowIso, revoked_by: row.created_by })
    .eq("listing_id", row.listing_id).eq("field", row.field).is("revoked_at", null);
  revoke = row.event_id == null ? revoke.is("event_id", null) : revoke.eq("event_id", row.event_id);
  const { error: revokeError } = await revoke;
  if (revokeError) { console.error("price-light corrections: replace failed", JSON.stringify(revokeError)); throw new Error(revokeError.message); }

  const { data, error } = await db.from("competitor_listing_corrections").insert({
    listing_id: row.listing_id, event_id: row.event_id, competitor: row.competitor, field: row.field,
    original: row.original, value: row.value, reason: row.reason, note: row.note, source: row.source,
    created_by: row.created_by,
  }).select(COLUMNS).single();
  if (error) { console.error("price-light corrections: insert failed", JSON.stringify(error)); throw new Error(error.message); }
  return data as ListingCorrection;
}

export async function revokeCorrection(id: number, by: string | null): Promise<ListingCorrection | null> {
  const { data, error } = await db.from("competitor_listing_corrections")
    .update({ revoked_at: new Date().toISOString(), revoked_by: by })
    .eq("id", id).is("revoked_at", null).select(COLUMNS).maybeSingle();
  if (error) { console.error("price-light corrections: revoke failed", JSON.stringify(error)); throw new Error(error.message); }
  return (data as ListingCorrection | null) ?? null;
}

/** Events whose answer from this competitor rests on this listing - the ones a listing-wide
 *  correction has to be re-matched for. Most recently matched first, capped by the caller. */
export async function eventsMatchedTo(listingId: number, limit: number): Promise<number[]> {
  const { data, error } = await db.from("competitor_matches").select("event_id,created_at")
    .eq("listing_id", listingId).order("created_at", { ascending: false }).limit(200);
  if (error) { console.error("price-light corrections: matched events read failed", JSON.stringify(error)); return []; }
  const ids = [...new Set(((data ?? []) as { event_id: number }[]).map((r) => r.event_id))];
  return ids.slice(0, limit);
}

export type CorrectionCounts = Partial<Record<CompetitorKey, { total: number; byField: Record<string, number> }>>;

/**
 * Corrections per competitor and field over the last `days` - the PARSER report. Most wrong
 * values in the comparison come from a site's parser, not from the AI, and no amount of agent
 * memory fixes a regex: eight star corrections on one competitor in a month is a bug to fix in
 * its crawler. Revoked rows count too - they were still a value someone had to fix.
 */
export async function correctionCounts(days: number): Promise<CorrectionCounts> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await db.from("competitor_listing_corrections").select("competitor,field")
    .gte("created_at", since).limit(2000);
  if (error) {
    if (!tableMissing(error)) console.error("price-light corrections: counts failed", JSON.stringify(error));
    return {};
  }
  const out: CorrectionCounts = {};
  for (const r of (data ?? []) as { competitor: CompetitorKey; field: string }[]) {
    const c = out[r.competitor] ?? { total: 0, byField: {} };
    c.total += 1;
    c.byField[r.field] = (c.byField[r.field] ?? 0) + 1;
    out[r.competitor] = c;
  }
  return out;
}
