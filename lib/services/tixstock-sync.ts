import { supabase } from "@/lib/supabase-server";
import {
  TixStockEvent,
  TixStockFeedResponse,
  TixStockEventDB,
} from "@/types/tixstock.types";

const TIXSTOCK_API_URL = process.env.NEXT_SECRET_TIXSTOCK_API_URL;
const TIXSTOCK_TOKEN = process.env.NEXT_SECRET_TIXSTOCK_TOKEN;

export interface TixStockSyncResult {
  count: number;
  status: "success" | "error";
  error?: string;
  pagesFailed?: number;
  pagesSkippedDeadline?: number;
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
}

async function fetchTixStockPage(page: number, attempt = 1): Promise<TixStockFeedResponse> {
  if (!TIXSTOCK_TOKEN) {
    throw new Error("TixStock API token is missing");
  }

  // include_listings=true so each event carries its listings — used only to
  // snapshot ticket availability (ticket_count); same page count as before.
  const url = `${TIXSTOCK_API_URL}/feed?page=${page}&per_page=50&include_listings=true`;
  console.log(`Fetching TixStock feed page ${page}...`);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TIXSTOCK_TOKEN}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    if (attempt < 2) return fetchTixStockPage(page, attempt + 1);
    throw new Error(`TixStock API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

function mapEventToDB(event: TixStockEvent): TixStockEventDB {
  return {
    event_id: event.id,
    event_name: event.name,
    show_date: event.datetime,
    event_status: event.status,
    venue_name: event.venue?.name || "Unknown Venue",
    city_name: event.venue?.city || "Unknown City",
    country_code: event.venue?.country_code || "",
    venue_data: event.venue,
    category_name: event.category?.name || "Other",
    sub_categories: event.category,
    performers: event.performers || [],
    venue_map_url: event.map_url,
    last_synced: new Date().toISOString(),
    is_active: event.status === "Active",
    // null (not an array) = feed didn't return listings; keep unknown rather than 0.
    ticket_count: Array.isArray(event.listings)
      ? event.listings.reduce(
          (sum, l) => sum + (l.number_of_tickets_for_sale?.quantity_available ?? 0),
          0,
        )
      : null,
  };
}

const PARALLEL_BATCH_SIZE = 10;

// Vercel caps the route at maxDuration 800s. Stop dispatching new batches at
// this deadline and finish cleanly instead of being killed mid-write — the
// 2026-08-12 run died at 782s around page 396/542 with no result or audit row.
// Unprocessed pages keep their previous snapshot and are picked up next run.
const SOFT_DEADLINE_MS = 700_000;

// Generated DB types predate ticket_count and type venue_data/sub_categories as
// Json — narrow the builder to the shape we actually use instead of `any`.
const tixstockTable = () =>
  supabase.from("tixstock_events") as unknown as {
    upsert: (
      rows: TixStockEventDB[],
      opts: { onConflict: string },
    ) => PromiseLike<{ error: { message: string } | null }>;
  };

export async function syncTixStockEvents(): Promise<TixStockSyncResult> {
  const startedAt = new Date();
  console.log(`Starting TixStock sync at ${startedAt.toISOString()}...`);

  try {
    let totalSynced = 0;

    // Fetch first page to discover total page count
    const firstResponse = await fetchTixStockPage(1);
    const lastPage = firstResponse.meta.last_page;
    console.log(`TixStock feed has ${lastPage} pages to sync.`);

    // Process first page immediately
    const firstEvents = (firstResponse.data || []).map(mapEventToDB);
    if (firstEvents.length > 0) {
      const { error } = await tixstockTable().upsert(firstEvents, {
        onConflict: "event_id",
      });
      if (error) throw error;
      totalSynced += firstEvents.length;
    }

    // Process remaining pages in parallel batches. Shuffled so that when a run
    // is cut by the deadline, the un-covered tail is different pages each night
    // instead of always starving the same ones.
    const remainingPages = Array.from(
      { length: lastPage - 1 },
      (_, i) => i + 2,
    );
    for (let i = remainingPages.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [remainingPages[i], remainingPages[j]] = [remainingPages[j], remainingPages[i]];
    }

    let pagesFailed = 0;
    let pagesSkippedDeadline = 0;

    for (let i = 0; i < remainingPages.length; i += PARALLEL_BATCH_SIZE) {
      if (Date.now() - startedAt.getTime() > SOFT_DEADLINE_MS) {
        pagesSkippedDeadline = remainingPages.length - i;
        console.warn(
          `Soft deadline reached — skipping remaining ${pagesSkippedDeadline} pages.`,
        );
        break;
      }

      const batch = remainingPages.slice(i, i + PARALLEL_BATCH_SIZE);

      // One failed page must not kill the whole sweep — retry happens inside
      // fetchTixStockPage; a page that still fails is skipped and logged.
      const responses = await Promise.all(
        batch.map((p) =>
          fetchTixStockPage(p).catch((err: Error) => {
            pagesFailed++;
            console.error(`Page ${p} failed after retry: ${err.message}`);
            return null;
          }),
        ),
      );
      const dbEvents = responses
        .filter((r): r is TixStockFeedResponse => r !== null)
        .flatMap((r) => (r.data || []).map(mapEventToDB));

      if (dbEvents.length > 0) {
        const { error } = await tixstockTable().upsert(dbEvents, {
          onConflict: "event_id",
        });
        if (error) {
          console.error("Error upserting TixStock events:", error);
          throw error;
        }
        totalSynced += dbEvents.length;
      }
    }

    const completedAt = new Date();
    const durationSeconds = Math.round(
      (completedAt.getTime() - startedAt.getTime()) / 1000,
    );
    console.log(
      `TixStock sync completed at ${completedAt.toISOString()}. Total events: ${totalSynced}. ` +
        `Pages failed: ${pagesFailed}, skipped at deadline: ${pagesSkippedDeadline}. Duration: ${durationSeconds}s`,
    );
    return {
      count: totalSynced,
      status: "success",
      pagesFailed,
      pagesSkippedDeadline,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationSeconds,
    };
  } catch (error) {
    const completedAt = new Date();
    const durationSeconds = Math.round(
      (completedAt.getTime() - startedAt.getTime()) / 1000,
    );
    console.error("TixStock sync failed:", error);
    return {
      count: 0,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationSeconds,
    };
  }
}
