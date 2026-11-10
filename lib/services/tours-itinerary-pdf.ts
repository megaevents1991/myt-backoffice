/**
 * The itinerary PDF of a tour date (Alon 10.11): the site's own print sheet, printed by headless Chromium and kept in
 * the public bucket - one file per date and choice of rooms (the sheet prints them and their total), printed again
 * after half an hour or once the site could show an edit (lib/tours/itinerary-pdf.ts holds the rules). Called by the
 * booking-link builder as soon as a date and its rooms are chosen (POST /api/tours/itinerary-pdf - a route with its own
 * time and memory, so the print never queues the builder's own actions behind it). prepareOffer only LOOKS the file up
 * (storedItineraryPdf) and puts its address in the offer's message. Never throws: a failed print is an answer, and the
 * offer goes out without the PDF.
 */
import { supabase } from "@/lib/supabase-server";
import type { Company } from "@/lib/company";
import { toursDb } from "@/lib/tours/db";
import { todayIso } from "@/lib/tours/format";
import { packagePathOf } from "@/lib/tours/cases";
import { ROOM_COMPOSITIONS, roomPrice, toPriceMatrix } from "@/lib/tours/pricing";
import { departureSiteId } from "@/types/tours.types";
import {
  ITINERARY_MIN_BYTES,
  isItineraryFresh,
  itineraryPageUrl,
  itineraryPdfPath,
  versionedUrl,
} from "@/lib/tours/itinerary-pdf";

const BUCKET = "public_resources";
/** The whole print - open the page, wait for its pictures, print - must end inside this. */
const PRINT_DEADLINE_MS = 45_000;
/** A picture of the sheet that never loads does not hold the print longer than this. */
const IMAGE_WAIT_MS = 8_000;

/** What a date needs to be printed - LinkDeparture carries all of it. */
export interface ItineraryDate {
  id: string;
  code: string;
  siteId: number;
  packagePath: string;
  /** The newest edit of the date or its tour (departures / packages updated_at). */
  changedAt: string | null;
  /** The room kinds the date's price table prices - the only rooms a print may name (review 10.11). */
  rooms?: string[];
}

export type ItineraryPdf = { ok: true; url: string; printed: boolean } | { ok: false; error: string };

/** A date of the company the site shows (published, not deleted, not past), as a print needs it; null = no such date. */
export async function itineraryDateOf(company: Company, departureId: string): Promise<ItineraryDate | null> {
  const { data, error } = await toursDb()
    .from("departures")
    .select("id, code, legacy_product_id, site_id, updated_at, packages(slug, data, updated_at)")
    .eq("company_id", company.id)
    .eq("id", departureId)
    .eq("is_published", true)
    .is("is_deleted", null)
    .gte("start_date", todayIso())
    .maybeSingle();
  if (error) throw new Error(`departures: ${error.message}`);
  const row = data as unknown as {
    id: string;
    code: string;
    legacy_product_id: number | null;
    site_id: number;
    updated_at: string | null;
    packages: { slug: string; data: unknown; updated_at: string | null } | null;
  } | null;
  if (!row?.packages) return null;
  const { data: prices, error: priceError } = await toursDb()
    .from("departure_prices")
    .select("pax_type, room_position, price")
    .eq("company_id", company.id)
    .eq("departure_id", row.id);
  if (priceError) throw new Error(`departure_prices: ${priceError.message}`);
  const matrix = toPriceMatrix((prices ?? []).map((p) => ({ pax_type: p.pax_type, room_position: p.room_position, price: Number(p.price) })));
  const dataPath = (row.packages.data as { path?: unknown } | null)?.path;
  const changed = [row.updated_at, row.packages.updated_at].filter((t): t is string => !!t).sort();
  return {
    id: row.id,
    code: row.code,
    siteId: departureSiteId(row),
    packagePath: packagePathOf(row.packages.slug, typeof dataPath === "string" ? dataPath : null),
    changedAt: changed[changed.length - 1] ?? null,
    rooms: ROOM_COMPOSITIONS.filter((c) => roomPrice(c.key, matrix) !== null).map((c) => c.key),
  };
}

/** When the stored file was last written, or null when there is none. */
async function storedAt(path: string): Promise<string | null> {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  const { data, error } = await supabase.storage.from(BUCKET).list(path.slice(0, slash), { search: name, limit: 10 });
  if (error) throw new Error(`storage list: ${error.message}`);
  const file = (data ?? []).find((f) => f.name === name);
  return file ? (file.updated_at ?? file.created_at ?? null) : null;
}

/** Prints the site page's own print sheet (`#print-sheet`, shown alone under print media) to an A4 PDF. */
export async function printItinerarySheet(url: string): Promise<Buffer> {
  const { withPrintPage } = await import("@/lib/services/browser");
  return withPrintPage(async (page) => {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    if (!(await page.$("#print-sheet"))) throw new Error("the site page has no print sheet");
    // the sheet's pictures are lazy on screen (it is hidden there): load them all before printing
    await page.evaluate(async (waitMs) => {
      const images = Array.from(document.querySelectorAll<HTMLImageElement>("#print-sheet img"));
      for (const img of images) img.loading = "eager";
      await Promise.all(
        images.map((img) =>
          img.complete
            ? null
            : new Promise((done) => {
                img.addEventListener("load", done, { once: true });
                img.addEventListener("error", done, { once: true });
                setTimeout(done, waitMs);
              }),
        ),
      );
      await document.fonts.ready;
    }, IMAGE_WAIT_MS);
    await page.emulateMedia({ media: "print" });
    // the sheet's own @page rule sets A4 and its margins
    return Buffer.from(await page.pdf({ printBackground: true, preferCSSPageSize: true }));
  });
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the print took over ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/**
 * The stored PDF of a date with these rooms, never a print: prepareOffer runs inside a page's server action, which has
 * neither the time nor the memory for Chromium (review 10.11) - the builder prints through the route before it
 * prepares. Under ITINERARY_FRESH_MS old = good; the route already printed again after an edit, so no rebuild rule here.
 */
export async function storedItineraryPdf(company: Company, date: { id: string; code: string }, rooms: readonly string[]): Promise<ItineraryPdf> {
  const path = itineraryPdfPath(company.slug, date, rooms);
  try {
    const stamp = await storedAt(path);
    if (stamp && isItineraryFresh(stamp, null, Date.now())) {
      return { ok: true, url: versionedUrl(supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl, stamp), printed: false };
    }
    return { ok: false, error: "The itinerary PDF was not ready." };
  } catch (e) {
    console.error(`[itinerary-pdf] ${company.slug} ${date.code}: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, error: "The itinerary PDF could not be read." };
  }
}

/** The PDF of a date with these rooms (keys already checked against the date's prices): the stored one while fresh, else printed now. */
export async function ensureItineraryPdf(
  company: Company,
  date: ItineraryDate,
  rooms: readonly string[],
  opts: { force?: boolean } = {},
): Promise<ItineraryPdf> {
  if (!company.siteUrl) return { ok: false, error: "The company has no site address." };
  const path = itineraryPdfPath(company.slug, date, rooms);
  const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  try {
    const stamp = await storedAt(path).catch((e) => {
      console.error(`[itinerary-pdf] ${company.slug} ${date.code}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });
    if (!opts.force && stamp && isItineraryFresh(stamp, date.changedAt, Date.now())) {
      return { ok: true, url: versionedUrl(publicUrl, stamp), printed: false };
    }
    const started = Date.now();
    const pdf = await withDeadline(printItinerarySheet(itineraryPageUrl(company.siteUrl, date.packagePath, date.siteId, rooms)), PRINT_DEADLINE_MS);
    if (pdf.length < ITINERARY_MIN_BYTES) throw new Error(`the print came out empty (${pdf.length} bytes)`);
    const { error } = await supabase.storage.from(BUCKET).upload(path, pdf, { contentType: "application/pdf", cacheControl: "300", upsert: true });
    if (error) throw new Error(`storage upload: ${error.message}`);
    console.log(`[itinerary-pdf] ${company.slug} ${date.code}: printed ${Math.round(pdf.length / 1024)} KB in ${Date.now() - started} ms`);
    return { ok: true, url: versionedUrl(publicUrl, new Date().toISOString()), printed: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[itinerary-pdf] ${company.slug} ${date.code}: ${error}`);
    return { ok: false, error: `The itinerary PDF could not be made (${error}).` };
  }
}
