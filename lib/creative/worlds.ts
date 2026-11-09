import { createHash } from "node:crypto";
import { supabase } from "@/lib/supabase-server";
import { renderWorldCoverPng, type CreativeSize } from "@/lib/creative/render";
import { tourCreativeFolder } from "@/lib/creative/tours";
import { STORAGE_BUCKET } from "@/lib/feed/publish-meta-feed";
import type { WorldCoverInput } from "@/components/creative/WorldCoverTemplate";
import type { FeedCompany, ToursReport, ToursReportWorld, WorldCover } from "@/lib/feed/tours-feed";

/**
 * The feed covers of a tours company's worlds (components/creative/WorldCoverTemplate.tsx; Dor 09.11.2026: the world's
 * picture "can serve the product feed"). Like the tours' pictures (lib/creative/tours.ts): no table and no state, what a
 * cover shows is hashed into its file name, in the same folder -
 *   creatives/output/auto/<company-slug>/world-<key>-<hash>-{square|banner}.png
 * and every drawn cover is also copied to an address that never changes, for an ad that keeps a link to it -
 *   public_resources/feeds/<company-slug>/world-<key>-{square|banner}.png
 * Drawn after the tours' pictures by the hourly creatives cron and by Website > Product Feed's "Sync now".
 */

/** Bump when the template changes what it draws, so every cover is drawn again. */
export const WORLD_COVER_VERSION = "w2";
const BUCKET = "creatives";
const SIZES: CreativeSize[] = ["square", "banner"];

/** What a cover shows, from the report's world and the company's logo. Pure. */
export function worldCoverInput(world: ToursReportWorld, logo: string): WorldCoverInput {
  return {
    name: world.name,
    brandName: world.brandName,
    tours: world.tours,
    image: world.image,
    logo,
    worldLogo: world.logo,
    color: world.color,
    colorDeep: world.colorDeep,
  };
}

/** The cover's hash: everything it draws, and the template's version. Pure. */
export function worldCoverHash(input: WorldCoverInput): string {
  const parts = [WORLD_COVER_VERSION, input.name, input.brandName, input.tours, input.image, input.logo, input.worldLogo, input.color, input.colorDeep];
  return createHash("sha1").update(JSON.stringify(parts)).digest("hex").slice(0, 12);
}

/** A world's key as a file name part (keys are staff-typed: letters, digits and dashes survive). Pure. */
export const worldFileKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "world";
export const worldCoverFile = (key: string, hash: string, size: CreativeSize) => `world-${worldFileKey(key)}-${hash}-${size}.png`;
/** The address that never changes (public_resources). Pure. */
export const worldCoverStablePath = (slug: string, key: string, size: CreativeSize) => `feeds/${slug}/world-${worldFileKey(key)}-${size}.png`;

const publicUrl = (bucket: string, path: string) => supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;

/** The look-up the publish uses: a world's cover when both sizes are drawn for what it shows now, else null. */
export function worldCoverLookup(slug: string, logo: string, existing: Set<string>): (world: ToursReportWorld) => WorldCover | null {
  return (world) => {
    const hash = worldCoverHash(worldCoverInput(world, logo));
    const [square, banner] = SIZES.map((size) => worldCoverFile(world.key, hash, size));
    if (!existing.has(square) || !existing.has(banner)) return null;
    return {
      square: publicUrl(BUCKET, `${tourCreativeFolder(slug)}/${square}`),
      banner: publicUrl(BUCKET, `${tourCreativeFolder(slug)}/${banner}`),
      stableSquare: publicUrl(STORAGE_BUCKET, worldCoverStablePath(slug, world.key, "square")),
      stableBanner: publicUrl(STORAGE_BUCKET, worldCoverStablePath(slug, world.key, "banner")),
    };
  };
}

export type WorldCoverRun = { current: number; drawn: string[]; errors: { key: string; error: string }[]; remaining: number };

/** Draws every cover the report's worlds lack, until `deadline`; adds the new file names to `existing`. Never throws. */
export async function ensureWorldCovers(company: FeedCompany, report: ToursReport, deadline: number, existing: Set<string>): Promise<WorldCoverRun> {
  const run: WorldCoverRun = { current: 0, drawn: [], errors: [], remaining: 0 };
  for (const world of report.worlds) {
    const input = worldCoverInput(world, report.logo);
    const hash = worldCoverHash(input);
    const files = SIZES.map((size) => ({ size, name: worldCoverFile(world.key, hash, size) }));
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
        const png = Buffer.from(await renderWorldCoverPng(input, f.size));
        // the address that never changes first (a short cache, so a redrawn cover reaches whoever links to it within
        // minutes), then the hashed file - whose being there is what says the cover is current, the copy included
        const stable = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(worldCoverStablePath(company.slug, world.key, f.size), png, { contentType: "image/png", cacheControl: "900", upsert: true });
        if (stable.error) throw new Error(stable.error.message);
        const drawn = await supabase.storage
          .from(BUCKET)
          .upload(`${tourCreativeFolder(company.slug)}/${f.name}`, png, { contentType: "image/png", cacheControl: "31536000", upsert: true });
        if (drawn.error) throw new Error(drawn.error.message);
        existing.add(f.name);
      }
      run.drawn.push(world.key);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[world-covers] ${company.slug} ${world.key} failed:`, message);
      run.errors.push({ key: world.key, error: message });
    }
  }
  return run;
}
