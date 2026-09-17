"use server";

/**
 * Attaching a second supplier to an existing event - always a human decision
 * made in the event editor. Nothing here writes to `events`: the actions only
 * FIND candidates and BUILD draft tickets; the editor adds them to its form
 * state and they are saved with the event like any other ticket.
 */
import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { normalizeForSearch } from "@/lib/search";
import { multiCurrencyExchangeRateService } from "@/lib/services/ticket-price-sync";
import {
  currencyFromCode,
  fetchLiveTicketsStock,
  liveTicketsPriceUsd,
  toLiveTicketsCategory,
  type LiveTicketsCategory,
  type RawLiveTicketsCategory,
} from "@/lib/services/livetickets-offers";
import type { EventTicket } from "@/types/app.types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const DAY_MS = 86_400_000;
/** How far from our date a supplier's event may be and still be offered. */
const CANDIDATE_WINDOW_DAYS = 3;
const MAX_CANDIDATES = 12;

export type LiveTicketsCandidate = {
  eventId: string;
  name: string;
  nameHeb: string;
  showDate: string;
  venue: string;
  /** Whole days between their date and ours - 0 is what we expect. */
  dateGapDays: number;
  /** Words of our event name found in theirs, 0..1. Sorts the list. */
  nameScore: number;
  sellableCategories: number;
};

export type LiveTicketsDraft = {
  ticket: EventTicket;
  category: LiveTicketsCategory;
};

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const words = (text: string): string[] =>
  normalizeForSearch(text)
    .split(/\s+/)
    .filter((w) => w.length > 2 && w !== "vs" && w !== "the");

interface LiveEventRow {
  event_id: number;
  event_name: string | null;
  event_name_heb: string | null;
  show_date: string;
  venues: { name?: string }[] | null;
  ticket_categories: RawLiveTicketsCategory[] | null;
}

/**
 * LiveTickets events that could be the same fixture as ours: within a few
 * days of our date, ranked by how much of our name they share. The operator
 * picks - a date gap is shown, never auto-resolved (LiveTickets lists
 * Real Madrid-Villarreal on 10.10, we have 11.10).
 */
export async function findLiveTicketsCandidates(
  eventNameEnglish: string,
  eventDateIso: string,
  search?: string,
): Promise<Result<LiveTicketsCandidate[]>> {
  await requireStaff();

  const ourDate = new Date(eventDateIso).getTime();
  if (!Number.isFinite(ourDate)) {
    return { ok: false, error: "Event has no date" };
  }

  let query = db
    .from("live_events")
    .select(
      "event_id,event_name,event_name_heb,show_date,venues,ticket_categories",
    )
    .eq("is_active", true)
    .order("show_date", { ascending: true })
    .limit(200);

  const term = search?.trim();
  if (term) {
    // A manual search widens the window - the operator knows what they want.
    query = query
      .ilike("event_name", `%${term.replace(/[%_]/g, "")}%`)
      .gte("show_date", new Date().toISOString());
  } else {
    const windowMs = CANDIDATE_WINDOW_DAYS * DAY_MS;
    query = query
      .gte("show_date", new Date(ourDate - windowMs).toISOString())
      .lte("show_date", new Date(ourDate + windowMs).toISOString());
  }

  const { data, error } = await query;
  if (error) {
    console.error("supplier-attach: candidates failed", JSON.stringify(error));
    return { ok: false, error: "Could not load LiveTickets events" };
  }

  const ourWords = words(eventNameEnglish);
  const candidates = ((data ?? []) as LiveEventRow[])
    .map((row): LiveTicketsCandidate => {
      const theirWords = new Set(words(row.event_name ?? ""));
      const shared = ourWords.filter((w) => theirWords.has(w)).length;
      const gap = Math.round(
        (new Date(row.show_date).getTime() - ourDate) / DAY_MS,
      );
      return {
        eventId: String(row.event_id),
        name: row.event_name ?? "",
        nameHeb: row.event_name_heb ?? "",
        showDate: row.show_date,
        venue: row.venues?.[0]?.name ?? "",
        dateGapDays: gap,
        nameScore: ourWords.length ? shared / ourWords.length : 0,
        sellableCategories: (row.ticket_categories ?? [])
          .map(toLiveTicketsCategory)
          .filter((c) => c.sellable).length,
      };
    })
    // Without a manual search, an event sharing no word with ours is noise.
    .filter((c) => term || c.nameScore > 0)
    .sort(
      (a, b) =>
        b.nameScore - a.nameScore ||
        Math.abs(a.dateGapDays) - Math.abs(b.dateGapDays),
    )
    .slice(0, MAX_CANDIDATES);

  return { ok: true, data: candidates };
}

/**
 * Draft tickets for every category of a LiveTickets event, priced now. Read
 * live from their API, falling back to our `live_events` snapshot when the
 * API is unreachable. Non-sellable categories come back too (flagged) so the
 * operator sees WHY something is missing; the editor only lets sellable ones in.
 */
export async function buildLiveTicketsDrafts(
  liveEventId: string,
): Promise<Result<LiveTicketsDraft[]>> {
  await requireStaff();
  if (!/^\d{1,12}$/.test(liveEventId)) {
    return { ok: false, error: "Invalid LiveTickets event id" };
  }

  let stock = await fetchLiveTicketsStock(liveEventId);
  if (stock === "SOLD_OUT") {
    return { ok: false, error: "LiveTickets reports this event as sold out" };
  }

  if (!stock) {
    const { data, error } = await db
      .from("live_events")
      .select("currency,ticket_categories")
      .eq("event_id", Number(liveEventId))
      .maybeSingle();
    const currency = data ? currencyFromCode(data.currency) : null;
    if (error || !data || !currency) {
      return {
        ok: false,
        error: "LiveTickets is unreachable and we hold no snapshot",
      };
    }
    stock = {
      currency,
      categories: (
        (data.ticket_categories ?? []) as RawLiveTicketsCategory[]
      ).map(toLiveTicketsCategory),
    };
  }

  try {
    await multiCurrencyExchangeRateService.updateAllExchangeRates();
  } catch (error) {
    console.warn("supplier-attach: using cached exchange rates", error);
  }

  const { currency, categories } = stock;
  return {
    ok: true,
    data: categories.map((category) => ({
      category,
      ticket: {
        // Their category id IS our ticket id - what the price sync and the
        // main app's live pricing match on. Never the category name.
        id: category.id,
        eid: liveEventId,
        supplier: "livetickets",
        vendor: "LiveTickets",
        category: category.title || category.hebTitle,
        supplierCategory: category.title || category.hebTitle,
        description: category.description,
        price: liveTicketsPriceUsd(category.cost, currency),
        colorOnTheMap: "rgb(5, 32, 60)",
        available: category.sellable,
      },
    })),
  };
}
