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
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
}

async function fetchTixStockPage(page: number): Promise<TixStockFeedResponse> {
  if (!TIXSTOCK_TOKEN) {
    throw new Error("TixStock API token is missing");
  }

  const url = `${TIXSTOCK_API_URL}/feed?page=${page}&per_page=50&include_listings=false`;
  console.log(`Fetching TixStock feed page ${page}...`);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TIXSTOCK_TOKEN}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
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
  };
}

const PARALLEL_BATCH_SIZE = 5;

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
      const { error } = await supabase
        .from("tixstock_events")
        .upsert(firstEvents as any, { onConflict: "event_id" });
      if (error) throw error;
      totalSynced += firstEvents.length;
    }

    // Process remaining pages in parallel batches
    const remainingPages = Array.from(
      { length: lastPage - 1 },
      (_, i) => i + 2,
    );

    for (let i = 0; i < remainingPages.length; i += PARALLEL_BATCH_SIZE) {
      const batch = remainingPages.slice(i, i + PARALLEL_BATCH_SIZE);
      console.log(
        `Fetching pages ${batch[0]}–${batch[batch.length - 1]} in parallel...`,
      );

      const responses = await Promise.all(
        batch.map((p) => fetchTixStockPage(p)),
      );
      const dbEvents = responses.flatMap((r) =>
        (r.data || []).map(mapEventToDB),
      );

      if (dbEvents.length > 0) {
        const { error } = await supabase
          .from("tixstock_events")
          .upsert(dbEvents as any, { onConflict: "event_id" });
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
      `TixStock sync completed at ${completedAt.toISOString()}. Total events: ${totalSynced}. Duration: ${durationSeconds}s`,
    );
    return {
      count: totalSynced,
      status: "success",
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationSeconds,
    };
  } catch (error: any) {
    const completedAt = new Date();
    const durationSeconds = Math.round(
      (completedAt.getTime() - startedAt.getTime()) / 1000,
    );
    console.error("TixStock sync failed:", error);
    return {
      count: 0,
      status: "error",
      error: error.message,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationSeconds,
    };
  }
}
