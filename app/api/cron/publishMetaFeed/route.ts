import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";

/**
 * Republishes the Meta product-catalog feed to Supabase Storage (a plain
 * static file, different host entirely) so Meta's fetcher never touches
 * Vercel's edge. Root cause: Vercel force-compresses every response on
 * mega-events.co.il with Brotli whenever a client's Accept-Encoding
 * includes "br" — confirmed true even for ISR/pre-rendered static routes,
 * regardless of the origin's own Content-Encoding or a Cache-Control:
 * no-transform directive (all three tried and verified live to make no
 * difference). Meta's fetcher advertises br support but apparently doesn't
 * actually decode it, so it always received undecodable binary and
 * rejected the feed as "file format isn't supported".
 *
 * The only reliable way found to get a genuinely uncompressed response from
 * mega-events.co.il is to explicitly request Accept-Encoding: identity —
 * verified live (Vercel then omits Content-Encoding entirely). This job
 * fetches that way, republishes the exact bytes as a static object, and the
 * main app's /feeds/meta-catalog.xml route 307-redirects there — so the
 * branded URL stays stable for Meta's registration while delivery bypasses
 * Vercel's forced compression completely.
 *
 * Supabase Storage's own CDN (Cloudflare) turned out to ALSO force-Brotli
 * any response typed as text/XML/JSON — confirmed live the object came
 * back content-encoding: br even freshly uploaded plain. Uploading with
 * Content-Type: application/octet-stream (verified live) makes Cloudflare
 * skip its compression heuristics entirely, since it no longer recognizes
 * the object as compressible text — the storage PATH still ends in .xml so
 * Meta's own format sniffing still has that signal to go on.
 */
export const maxDuration = 60;

// `?source=1` = live build. The bare XML URL 307-redirects to the published
// snapshot in storage — fetching THAT here would republish our own previous
// output forever (exactly what silently froze the feed 2026-07-20 → 22).
// Hence redirect: "error" + the X-Feed-Generated check below. The CSV route
// always serves live (no redirect) but carries the same header.
const SOURCE_XML_URL = "https://www.mega-events.co.il/feeds/meta-catalog.xml?source=1";
const SOURCE_CSV_URL = "https://www.mega-events.co.il/feeds/meta-catalog.csv";
// Meta's ACTIVITIES vertical — the shape Meta actually accepts for our
// catalog (the e-commerce XML/CSV above are kept for Google Merchant).
const SOURCE_ACTIVITIES_URL = "https://www.mega-events.co.il/feeds/meta-activities.csv";
const STORAGE_BUCKET = "public_resources";
// "-feed" suffix deliberately avoids the plain "feeds/meta-catalog.xml"
// path — that one got Cloudflare-cache-poisoned during testing (same
// content → same weak etag every run → Cloudflare kept serving cached
// br-compressed headers from before the octet-stream fix, never re-validating).
const STORAGE_PATH_XML = "feeds/meta-catalog-feed.xml";
// CSV mirror of the CMO's verified-working feed_ready.csv shape — the format
// Meta demonstrably imports with 0 errors. Registered in Meta as the primary
// scheduled feed; the XML stays published as a fallback/secondary.
const STORAGE_PATH_CSV = "feeds/meta-catalog-feed.csv";
/** The URL registered in Meta Commerce Manager. */
const STORAGE_PATH_ACTIVITIES = "feeds/meta-activities-feed.csv";

async function fetchLiveSource(url: string, expectedPrefix: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { "Accept-Encoding": "identity" },
    cache: "no-store",
    redirect: "error",
  });
  if (!res.ok) {
    throw new Error(`${url} returned HTTP ${res.status}`);
  }
  if (!res.headers.get("x-feed-generated")) {
    // Only the live builds set this header — its absence means we're NOT
    // talking to a fresh serialization (e.g. someone reverted ?source=1).
    throw new Error(`${url} missing X-Feed-Generated — not a live build`);
  }
  const contentEncoding = res.headers.get("content-encoding");
  if (contentEncoding) {
    // Should never happen with Accept-Encoding: identity — but never
    // publish a compressed body as if it were plain text.
    throw new Error(`${url} still compressed (content-encoding: ${contentEncoding})`);
  }
  const body = Buffer.from(await res.arrayBuffer());
  if (!body.toString("utf-8", 0, 40).trim().startsWith(expectedPrefix)) {
    throw new Error(`${url} body doesn't start with "${expectedPrefix}"`);
  }
  return body;
}

async function publish(path: string, body: Buffer, contentType: string): Promise<string> {
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, body, {
    contentType,
    cacheControl: "900",
    upsert: true,
  });
  if (error) throw error;
  return supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;

  try {
    const [xmlBody, csvBody, activitiesBody] = await Promise.all([
      fetchLiveSource(SOURCE_XML_URL, "<?xml"),
      fetchLiveSource(SOURCE_CSV_URL, "id,title"),
      fetchLiveSource(SOURCE_ACTIVITIES_URL, "id,image_link"),
    ]);

    // XML: NOT application/xml — Cloudflare (Supabase Storage's CDN) Brotli-
    // compresses text/XML types for clients that advertise br; octet-stream
    // makes it skip compression entirely (verified live) while the .xml path
    // still gives Meta's own sniffing something to go on.
    // CSV: text/csv with standard negotiation (gzip/br only when the client
    // advertises it) — mirrors how the verified-working file was served.
    const [xmlUrl, csvUrl, activitiesUrl] = await Promise.all([
      publish(STORAGE_PATH_XML, xmlBody, "application/octet-stream"),
      publish(STORAGE_PATH_CSV, csvBody, "text/csv; charset=utf-8"),
      publish(STORAGE_PATH_ACTIVITIES, activitiesBody, "text/csv; charset=utf-8"),
    ]);

    console.log(
      `[publishMetaFeed] published xml ${xmlBody.length}B, csv ${csvBody.length}B, ` +
        `activities ${activitiesBody.length}B → ${activitiesUrl}`
    );
    return NextResponse.json({
      published: true,
      xmlBytes: xmlBody.length,
      csvBytes: csvBody.length,
      activitiesBytes: activitiesBody.length,
      xmlUrl,
      csvUrl,
      activitiesUrl,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[publishMetaFeed] failed:", message);
    return NextResponse.json({ published: false, error: message }, { status: 500 });
  }
}
