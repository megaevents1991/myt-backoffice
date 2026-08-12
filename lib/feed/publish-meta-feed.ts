import { supabase } from "@/lib/supabase-server";

/**
 * Publishes the Meta/Google feed snapshots to Supabase Storage. Shared by the
 * scheduled cron (`/api/cron/publishMetaFeed`) and the "Sync now" button on
 * /meta-feed, so a manual sync is byte-for-byte what the cron does.
 *
 * Why snapshots at all: Meta fetches a static file on a CDN that has no app in
 * the path. The main app builds the feed live; this copies those exact bytes
 * to Storage.
 */

// `?source=1` = live build. The bare XML URL 307-redirects to the published
// snapshot in storage - fetching THAT here would republish our own previous
// output forever (exactly what silently froze the feed 2026-07-20 → 22).
// Hence redirect: "error" + the X-Feed-Generated check below. The CSV routes
// always serve live (no redirect) but carry the same header.
const SOURCE_XML_URL =
  "https://www.mega-events.co.il/feeds/meta-catalog.xml?source=1";
const SOURCE_CSV_URL = "https://www.mega-events.co.il/feeds/meta-catalog.csv";
// Meta's ACTIVITIES vertical - the shape Meta actually accepts for our
// catalog (the e-commerce XML/CSV above are kept for Google Merchant).
const SOURCE_ACTIVITIES_URL =
  "https://www.mega-events.co.il/feeds/meta-activities.csv";

export const STORAGE_BUCKET = "public_resources";
// "-feed" suffix deliberately avoids the plain "feeds/meta-catalog.xml"
// path - that one got Cloudflare-cache-poisoned during testing (same
// content → same weak etag every run → Cloudflare kept serving cached
// br-compressed headers from before the octet-stream fix, never re-validating).
export const STORAGE_PATH_XML = "feeds/meta-catalog-feed.xml";
// CSV mirror of the CMO's verified-working feed_ready.csv shape (e-commerce
// vertical - kept for Google Merchant).
export const STORAGE_PATH_CSV = "feeds/meta-catalog-feed.csv";
/** The URL registered in Meta Commerce Manager (activities vertical). */
export const STORAGE_PATH_ACTIVITIES = "feeds/meta-activities-feed.csv";

export type PublishResult = {
  xmlBytes: number;
  csvBytes: number;
  activitiesBytes: number;
  xmlUrl: string;
  csvUrl: string;
  activitiesUrl: string;
  /** Rows in the activities feed (header excluded). */
  activityRows: number;
};

async function fetchLiveSource(
  url: string,
  expectedPrefix: string,
): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { "Accept-Encoding": "identity" },
    cache: "no-store",
    redirect: "error",
  });
  if (!res.ok) {
    throw new Error(`${url} returned HTTP ${res.status}`);
  }
  if (!res.headers.get("x-feed-generated")) {
    // Only the live builds set this header - its absence means we're NOT
    // talking to a fresh serialization (e.g. someone reverted ?source=1).
    throw new Error(`${url} missing X-Feed-Generated - not a live build`);
  }
  const contentEncoding = res.headers.get("content-encoding");
  if (contentEncoding) {
    // Should never happen with Accept-Encoding: identity - but never
    // publish a compressed body as if it were plain text.
    throw new Error(
      `${url} still compressed (content-encoding: ${contentEncoding})`,
    );
  }
  const body = Buffer.from(await res.arrayBuffer());
  if (!body.toString("utf-8", 0, 40).trim().startsWith(expectedPrefix)) {
    throw new Error(`${url} body doesn't start with "${expectedPrefix}"`);
  }
  return body;
}

async function publish(
  path: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, body, {
      contentType,
      cacheControl: "900",
      upsert: true,
    });
  if (error) throw error;
  return supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path).data
    .publicUrl;
}

/** Throws with a human-readable message when any step fails. */
export async function publishMetaFeeds(): Promise<PublishResult> {
  const [xmlBody, csvBody, activitiesBody] = await Promise.all([
    fetchLiveSource(SOURCE_XML_URL, "<?xml"),
    fetchLiveSource(SOURCE_CSV_URL, "id,title"),
    fetchLiveSource(SOURCE_ACTIVITIES_URL, "id,image_link"),
  ]);

  // XML: NOT application/xml - Cloudflare (Supabase Storage's CDN) Brotli-
  // compresses text/XML types for clients that advertise br; octet-stream
  // makes it skip compression entirely (verified live) while the .xml path
  // still gives Meta's own sniffing something to go on.
  // CSV: text/csv with standard negotiation - mirrors how the
  // verified-working file was served.
  const [xmlUrl, csvUrl, activitiesUrl] = await Promise.all([
    publish(STORAGE_PATH_XML, xmlBody, "application/octet-stream"),
    publish(STORAGE_PATH_CSV, csvBody, "text/csv; charset=utf-8"),
    publish(STORAGE_PATH_ACTIVITIES, activitiesBody, "text/csv; charset=utf-8"),
  ]);

  const activityRows = Math.max(
    0,
    activitiesBody.toString("utf-8").trim().split("\r\n").length - 1,
  );

  return {
    xmlBytes: xmlBody.length,
    csvBytes: csvBody.length,
    activitiesBytes: activitiesBody.length,
    xmlUrl,
    csvUrl,
    activitiesUrl,
    activityRows,
  };
}
