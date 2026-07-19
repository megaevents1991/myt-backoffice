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
 */
export const maxDuration = 60;

const SOURCE_URL = "https://www.mega-events.co.il/feeds/meta-catalog.xml";
const STORAGE_BUCKET = "public_resources";
const STORAGE_PATH = "feeds/meta-catalog.xml";

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;

  try {
    const res = await fetch(SOURCE_URL, {
      headers: { "Accept-Encoding": "identity" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Source feed returned HTTP ${res.status}`);
    }
    const contentEncoding = res.headers.get("content-encoding");
    if (contentEncoding) {
      // Should never happen with Accept-Encoding: identity — but never
      // publish a compressed body as if it were plain XML.
      throw new Error(`Source feed still compressed (content-encoding: ${contentEncoding})`);
    }
    const body = Buffer.from(await res.arrayBuffer());
    if (!body.toString("utf-8", 0, 20).trim().startsWith("<?xml")) {
      throw new Error("Source feed body doesn't look like XML");
    }

    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(STORAGE_PATH, body, {
        contentType: "application/xml; charset=utf-8",
        cacheControl: "900",
        upsert: true,
      });
    if (error) throw error;

    const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(STORAGE_PATH);
    console.log(`[publishMetaFeed] published ${body.length} bytes to ${data.publicUrl}`);
    return NextResponse.json({ published: true, bytes: body.length, url: data.publicUrl });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[publishMetaFeed] failed:", message);
    return NextResponse.json({ published: false, error: message }, { status: 500 });
  }
}
