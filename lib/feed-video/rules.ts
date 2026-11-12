// Feed videos - the pure rules, shared by the hand tool (scripts/feed-video/) and the system
// (spec docs/superpowers/specs/2026-11-12-feed-video-in-system-design.md). No DB, no fetch, no
// browser: what a video prints, which style it draws, the file it lives in, when it is held, and
// whether an opening line may go on it. Selftest: npx tsx scripts/feed-video-selftest.ts
//
// The hash and the style draw are the hand tool's of 11.11 byte for byte - its 80 lines and files
// carry over only while they stay so (1175's video = e51c3b6a45, live since 12.11).

import { createHash } from "node:crypto";
import { buildPriceText, cityOf, creativeTagline } from "@/components/creative/MatchTemplate";
import type { CreativeDefaults } from "@/lib/creative/auto";
import type { VideoPage } from "./template";

export type VideoStyle = "A" | "B" | "C";

/** What a video prints. The key order is part of the hash - never reorder. */
export type PrintedVideo = Omit<VideoPage, "hook" | "logoSvg" | "fontDataUrl">;

/** Bump when a template changes - every video renders again. */
export const TEMPLATE_VERSION = 2;
export const VIDEO_BUCKET = "public_resources";
export const VIDEO_DIR = "creatives/video";

/**
 * The styles an artist's pictures can carry, always in A, B, C order (the draw is modulo this list):
 *   A (poster in motion)   - a cut-out;
 *   B (fast Reels cuts)    - a cut-out and three stage photos;
 *   C (concert atmosphere) - one stage photo or more.
 */
export function stylesFor(a: { cutout: string | null; photos: string[] }): VideoStyle[] {
  const out: VideoStyle[] = [];
  if (a.cutout) out.push("A");
  if (a.cutout && a.photos.length >= 3) out.push("B");
  if (a.photos.length >= 1) out.push("C");
  return out;
}

/** The style an event draws - once, from its id, among the styles its artist can carry. */
export function drawStyle(eventId: number, styles: VideoStyle[]): VideoStyle {
  const h = createHash("sha1").update(`feed-video-style:${eventId}`).digest();
  return styles[h.readUInt32BE(0) % styles.length];
}

/** A stored style stays while the artist still carries it; otherwise the event draws again. */
export function keepOrDrawStyle(stored: VideoStyle | null, eventId: number, styles: VideoStyle[]): VideoStyle {
  return stored && styles.includes(stored) ? stored : drawStyle(eventId, styles);
}

export function videoHash(printed: PrintedVideo, line: string): string {
  return createHash("sha1")
    .update(JSON.stringify({ v: TEMPLATE_VERSION, hook: line, ...printed }))
    .digest("hex")
    .slice(0, 10);
}

export function videoFileName(eventId: number, style: VideoStyle, hash: string): string {
  return `event-${eventId}-${style}-${hash}.mp4`;
}

/** A video the system made (ours to replace or take down) - never one uploaded by hand. */
export function isSystemVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).pathname.includes(`/${VIDEO_DIR}/`);
  } catch {
    return false;
  }
}

/**
 * Why an event gets no video (and no Claude call) today - empty = fine. The video prints the site
 * card price, so it must equal the feed row's price; the place is the show's city alone.
 */
export function holdProblems(x: {
  expectedName: string;
  eventArtistName: string | null;
  kind: string;
  sitePrice: number | null;
  feedPrice: number;
  place: string;
}): string[] {
  const problems: string[] = [];
  if (x.kind !== "artist" || (x.eventArtistName ?? "").trim() !== x.expectedName) {
    problems.push(`artist is "${x.eventArtistName}" - expected "${x.expectedName}"`);
  }
  if (x.sitePrice === null) problems.push("no site price");
  else if (Math.abs(x.sitePrice - x.feedPrice) >= 1) {
    problems.push(`site price $${x.sitePrice} != live feed $${x.feedPrice}`);
  }
  // A place that reads as a travel note ("נבוורת טיסה ללונדון . בריטניה" - the location row's own
  // name) is held for a person to fix the location.
  if (!x.place) problems.push("no place");
  else if (/טיסה|\s\.\s/.test(x.place)) problems.push(`place reads "${x.place}" - fix the location's name first`);
  return problems;
}

/** What the video of an event prints, from its creative defaults (the image ad's own reading). */
export function printedFor(
  d: Pick<CreativeDefaults, "locationText" | "dateText" | "price" | "ticketOnly">,
  a: { name: string; cutout: string; photos: string[]; cutoutInC: boolean },
  style: VideoStyle,
  priceOn: boolean,
): PrintedVideo {
  return {
    style,
    name: a.name,
    place: cityOf(d.locationText),
    date: d.dateText,
    priceText: priceOn && d.price !== null ? buildPriceText(d.ticketOnly ? "ticket" : "package", d.price, "$") : null,
    tagline: creativeTagline(d.ticketOnly),
    cta: d.ticketOnly ? "כרטיס בלבד" : "טיסה + מלון + כרטיס",
    cutout: a.cutout,
    photos: a.photos,
    cutoutInC: a.cutoutInC,
  };
}

// ---------- opening lines ----------
export const LINE_MAX_CHARS = 34;

/** Why a line cannot go on a video, or null. */
export function lineProblem(line: string, others: string[]): string | null {
  const t = line.trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (!/[֐-׿]/.test(t)) return "no Hebrew";
  if (t.length > LINE_MAX_CHARS) return `longer than ${LINE_MAX_CHARS}`;
  if (words.length < 3 || words.length > 7) return "needs 3-7 words";
  if (/[0-9$₪€£%]/.test(t)) return "a number or a price";
  // A geresh is part of a city's name (מנצ'סטר) - only real quotation marks are refused.
  if (/["״«»“”]/.test(t)) return "quotes";
  if (/בירה|יין|אלכוהול|שיכור|וודקה|קוקטייל/.test(t)) return "alcohol";
  if ((t.match(/!/g) ?? []).length > 1) return "more than one !";
  if (others.includes(t)) return "same as another show";
  return null;
}

export const LINES_SYSTEM = `You write the opening line of a 10-second video ad for a travel company that sells
packages (flight + hotel + concert ticket) to see an artist live abroad. The audience is Israeli; write
in natural, everyday Hebrew, addressed to the plural "you" (אתם) or with no addressee at all.
The line is the hook of the first 2.5 seconds: an emotion or a picture of the night itself.
Rules:
- 3 to 7 words, at most ${LINE_MAX_CHARS} characters, one sentence, no emoji, no quotation marks.
- No numbers, no prices, no dates, no "last tickets", "selling out" or any other urgency or scarcity.
- The show is months away: no "tonight" or "today" that reads as if it is happening now (הלילה / היום).
- No alcohol, no drinking.
- No facts about the artist or the tour (no "reunion", "farewell", "first time", "only show"), no song
  titles and no lyrics - only what is true of any great night of live music.
- The artist's name, the city and the date appear right after the line, so the line need not repeat
  them; you may name the city when it makes the line better.
- Every show gets its own line - no two lines the same, and vary the openings.`;
