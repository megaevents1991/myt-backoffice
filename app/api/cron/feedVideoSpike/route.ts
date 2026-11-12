import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { supabase, supabaseTyped } from "@/lib/supabase-server";
import { deriveCreativeDefaults } from "@/lib/creative/auto";
import { drawStyle, printedFor, VIDEO_BUCKET } from "@/lib/feed-video/rules";
import { videoHtml } from "@/lib/feed-video/template";
import { renderVideo, videoFontDataUrl, videoLogoSvg } from "@/lib/services/feed-video-render";
import { VIDEO_ARTISTS } from "@/scripts/feed-video/config";

/**
 * The feed-video SPIKE (plan docs/superpowers/plans/2026-11-12-feed-video-in-system.md, Task 2):
 * renders ONE event's video on Vercel and answers how long it took, so the in-system design is
 * measured before it is built on. It writes only to `creatives/video-spike/` - never to the
 * feed's `creatives/video/`, never to `events` - and calls no AI.
 *   GET /api/cron/feedVideoSpike?only=<eventId>[&line=<opening line>]   (cron bearer)
 * Called several at once it also shows how many instances answered (fluid compute may share one).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const INSTANCE = randomUUID().slice(0, 8);
const SPIKE_DIR = "creatives/video-spike";
const DEFAULT_LINE = "ערב שתזכרו עוד הרבה שנים";

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;
  const id = Number(request.nextUrl.searchParams.get("only"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "?only=<eventId> is required" }, { status: 400 });
  const line = (request.nextUrl.searchParams.get("line") ?? DEFAULT_LINE).trim() || DEFAULT_LINE;
  const t0 = Date.now();
  try {
    const d = await deriveCreativeDefaults(id, {});
    const { data: rows, error } = await supabaseTyped
      .from("artists")
      .select("id,name")
      .in("id", VIDEO_ARTISTS.map((a) => a.id));
    if (error) throw new Error(JSON.stringify(error));
    const row = (rows ?? []).find((r) => (r.name ?? "").trim() === (d.artistName ?? "").trim());
    const artist = row && VIDEO_ARTISTS.find((a) => a.id === row.id);
    if (!row || !artist) {
      return NextResponse.json({ error: `event ${id} is not a show of a video artist (${d.artistName})` }, { status: 400 });
    }
    const style = drawStyle(id, artist.styles);
    const printed = printedFor(d, { name: row.name.trim(), ...artist }, style, true);
    const tPlan = Date.now();
    const { mp4, ms: renderMs } = await renderVideo(
      videoHtml({ ...printed, hook: line, logoSvg: await videoLogoSvg(), fontDataUrl: videoFontDataUrl() }),
    );
    const objectPath = `${SPIKE_DIR}/event-${id}-${style}-${Date.now()}.mp4`;
    const up = await supabase.storage.from(VIDEO_BUCKET).upload(objectPath, mp4, { contentType: "video/mp4", upsert: false });
    if (up.error) throw new Error(`upload failed: ${up.error.message}`);
    const url = supabase.storage.from(VIDEO_BUCKET).getPublicUrl(objectPath).data.publicUrl;
    const body = {
      id, style, line, bytes: mp4.length, url,
      planMs: tPlan - t0, renderMs, totalMs: Date.now() - t0,
      instance: INSTANCE, region: process.env.VERCEL_REGION ?? null,
    };
    console.log(`[feedVideoSpike] ${JSON.stringify(body)}`);
    return NextResponse.json(body);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[feedVideoSpike] event ${id} failed after ${Date.now() - t0}ms:`, message);
    return NextResponse.json({ id, error: message, totalMs: Date.now() - t0, instance: INSTANCE }, { status: 500 });
  }
}
