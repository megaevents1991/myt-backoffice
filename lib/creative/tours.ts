import { createHash } from "node:crypto";
import { supabase } from "@/lib/supabase-server";
import { renderTourCreativePng, type CreativeSize } from "@/lib/creative/render";
import type { TourCreativeInput } from "@/components/creative/TourTemplate";
import type { FeedCompany, ToursReport, ToursReportItem, TourCreative } from "@/lib/feed/tours-feed";

/**
 * The branded Meta pictures of a tours company's tours (mega-family docs/plans/PRODUCT-FEED-PLAN.md).
 *
 * No table and no state: what a picture shows is hashed into its file name -
 *   creatives/output/auto/<company-slug>/tour-<id>-<hash>-{square|banner}.png
 * so a picture that exists is current, a tour whose name, price, dates or photo changed gets a new file, and nothing is
 * ever written to tours.packages (the tour editor writes there). Drawn by the hourly creatives cron (after Mega Events'
 * events, inside the same time budget) and by Website > Product Feed's "Sync now"; the publish only looks the files up.
 */

/** Bump when the template changes what it draws, so every tour is drawn again. */
export const TOUR_RENDER_VERSION = "t1";
const BUCKET = "creatives";
const SIZES: CreativeSize[] = ["square", "banner"];

/** What a picture shows, from the report's item and the company's logo. Pure. */
export function tourCreativeInput(item: ToursReportItem, logo: string): TourCreativeInput {
  return {
    name: item.name,
    places: item.places,
    includesText: item.includesText,
    dateText: item.dateText,
    datesCount: item.datesCount,
    priceText: item.priceText,
    priceRegularText: item.priceRegularText,
    priceNote: item.priceNote ?? "",
    onSale: item.onSale,
    image: item.image,
    logo,
    color: item.color,
    colorDeep: item.colorDeep,
  };
}

/** The picture's hash: everything it draws, and the template's version. Pure. */
export function tourCreativeHash(input: TourCreativeInput): string {
  const parts = [
    TOUR_RENDER_VERSION,
    input.name,
    input.places,
    input.includesText,
    input.dateText,
    input.datesCount,
    input.priceText,
    input.priceRegularText,
    input.priceNote,
    input.onSale,
    input.image,
    input.logo,
    input.color,
    input.colorDeep,
  ];
  return createHash("sha1").update(JSON.stringify(parts)).digest("hex").slice(0, 12);
}

/** The folder of a company's tour pictures, and a picture's file name in it. Pure. */
export const tourCreativeFolder = (slug: string) => `output/auto/${slug}`;
export const tourCreativeFile = (id: string, hash: string, size: CreativeSize) => `tour-${id}-${hash}-${size}.png`;

const publicUrl = (path: string) => supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

/** The file names already in the company's folder (one listing per run). */
export async function listTourCreatives(slug: string): Promise<Set<string>> {
  const names = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(BUCKET).list(tourCreativeFolder(slug), { limit: 1000, offset });
    if (error) throw new Error(`creatives list: ${error.message}`);
    for (const f of data ?? []) names.add(f.name);
    if (!data || data.length < 1000) break;
  }
  return names;
}

/** The look-up the publish uses: an item's two pictures when both are drawn for what it shows now, else null. */
export function tourCreativeLookup(slug: string, logo: string, existing: Set<string>): (item: ToursReportItem) => TourCreative | null {
  return (item) => {
    const hash = tourCreativeHash(tourCreativeInput(item, logo));
    const [square, banner] = SIZES.map((size) => tourCreativeFile(item.id, hash, size));
    if (!existing.has(square) || !existing.has(banner)) return null;
    return { square: publicUrl(`${tourCreativeFolder(slug)}/${square}`), banner: publicUrl(`${tourCreativeFolder(slug)}/${banner}`) };
  };
}

export type TourCreativeRun = { company: string; current: number; drawn: string[]; errors: { id: string; error: string }[]; remaining: number };

/** Draws every picture a report's tours lack, until `deadline` (ms since epoch). Returns the folder's names after it. */
export async function ensureTourCreatives(company: FeedCompany, report: ToursReport, deadline: number): Promise<{ run: TourCreativeRun; existing: Set<string> }> {
  const existing = await listTourCreatives(company.slug);
  const run: TourCreativeRun = { company: company.slug, current: 0, drawn: [], errors: [], remaining: 0 };
  for (const item of report.items) {
    const input = tourCreativeInput(item, report.logo);
    const hash = tourCreativeHash(input);
    const files = SIZES.map((size) => ({ size, name: tourCreativeFile(item.id, hash, size) }));
    if (files.every((f) => existing.has(f.name))) {
      run.current++;
      continue;
    }
    if (Date.now() > deadline) {
      run.remaining++;
      continue;
    }
    try {
      for (const f of files) {
        if (existing.has(f.name)) continue;
        const png = await renderTourCreativePng(input, f.size);
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(`${tourCreativeFolder(company.slug)}/${f.name}`, Buffer.from(png), { contentType: "image/png", cacheControl: "31536000", upsert: true });
        if (error) throw new Error(error.message);
        existing.add(f.name);
      }
      run.drawn.push(item.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[tour-creatives] ${company.slug} ${item.id} failed:`, message);
      run.errors.push({ id: item.id, error: message });
    }
  }
  return { run, existing };
}
