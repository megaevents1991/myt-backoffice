import { supabase } from "@/lib/supabase-server";
import { toActivitiesCsv, type ActivityRow } from "@/lib/feed/activities-csv";
import { STORAGE_BUCKET } from "@/lib/feed/publish-meta-feed";

/**
 * The Meta product feed of a TOURS company (mega-family docs/plans/PRODUCT-FEED-PLAN.md, Dor 08.11.2026): one item per
 * tour, a Meta Activities catalog like Mega Events', branded pictures.
 *
 * The company's own site says what it sells: `<site_url>/feeds/tours.json` holds every tour as the catalog gets it
 * (the price its card prints, live dates, the link, the labels) and the tours left out with why - so no price rule is
 * repeated here. This module turns that report into the Activities CSV (lib/feed/activities-csv.ts, the bytes of
 * Mega Events' file) and publishes it, with the report and the pictures' addresses, to Storage:
 *   public_resources/feeds/<company-slug>/meta-activities-feed.csv   <- the file registered in Commerce Manager
 *   public_resources/feeds/<company-slug>/report.json                <- what Website > Product Feed shows
 * Meta never fetches the company site itself: Vercel forces Brotli on its fetcher (see publish-meta-feed.ts).
 */

/** One tour as the site's /feeds/tours.json gives it (mega-family lib/feed/tours-feed.ts TourFeedItem). */
export type ToursReportItem = {
  id: string;
  title: string;
  description: string;
  price: string;
  priceValue: number;
  currency: string;
  priceRegularValue: number | null;
  link: string;
  image: string;
  gallery: string[];
  activity_category: string;
  performers: string;
  location_names: string;
  activity_sub_categories: string;
  activity_date: string;
  labels: [string, string, string, string, string];
  /** The tour's slug (tours.packages.slug). */
  slug: string;
  name: string;
  places: string;
  dateText: string;
  datesCount: number;
  priceText: string;
  priceRegularText: string;
  /** What the price is of, as the card prints it ("לפי זוג בחדר כפול"). */
  priceNote: string;
  includesText: string;
  color: string;
  colorDeep: string;
  world: string;
  onSale: boolean;
};

export type ToursReportSkip = {
  id: string;
  name: string;
  slug: string;
  reason: "waitlist" | "no-price" | "no-image";
  why: { missing: string; fix: string; actionable: boolean };
};

export type ToursReport = {
  generatedAt: string;
  siteBuiltAt: string | null;
  live: boolean;
  origin: string;
  /** The site header's logo, absolute (the branded pictures carry it). */
  logo: string;
  items: ToursReportItem[];
  skipped: ToursReportSkip[];
};

/** The company a feed belongs to (lib/company.ts Company, the fields used here). */
export type FeedCompany = { id: string; slug: string; name: string; siteUrl: string | null };

/** The pictures of one tour, when both are drawn (lib/creative/tours.ts). */
export type TourCreative = { square: string; banner: string };

/** What a publish leaves in Storage next to the CSV - the Product Feed screen reads it. */
export type PublishedToursReport = ToursReport & {
  publishedAt: string;
  csvUrl: string;
  /** The picture each item went out with: its branded one, or its own photo while that is not drawn yet. */
  images: Record<string, { image: string; branded: boolean; banner: string | null }>;
};

export const toursFeedPath = (slug: string) => `feeds/${slug}/meta-activities-feed.csv`;
export const toursReportPath = (slug: string) => `feeds/${slug}/report.json`;

/** The brand column: the company's own name (Mega Events' file says "Mega Events"). */
export const TOURS_FEED_BRAND: Record<string, string> = { "mega-family": "מגה תיירות" };

/** The report checked for shape, so a broken answer never becomes a file Meta reads. */
export function parseToursReport(value: unknown): ToursReport {
  const r = value as Partial<ToursReport> | null;
  if (!r || typeof r !== "object" || !Array.isArray(r.items) || !Array.isArray(r.skipped)) {
    throw new Error("the tours report has no items / skipped lists");
  }
  for (const it of r.items) {
    if (!it || typeof it.id !== "string" || !it.id.startsWith("mf-") || typeof it.price !== "string" || typeof it.link !== "string") {
      throw new Error("the tours report has an item without id / price / link");
    }
  }
  if (r.items.length + r.skipped.length === 0) {
    // a site with no tour at all is a broken build, not an empty catalog: keep the previous file
    throw new Error("the tours report lists no tour at all");
  }
  return {
    generatedAt: String(r.generatedAt ?? ""),
    siteBuiltAt: r.siteBuiltAt ? String(r.siteBuiltAt) : null,
    live: !!r.live,
    origin: String(r.origin ?? ""),
    logo: String(r.logo ?? ""),
    items: r.items as ToursReportItem[],
    skipped: r.skipped as ToursReportSkip[],
  };
}

/** The company site's tours report, fetched like the Mega Events sources: no redirect, plain bytes, a live answer. */
export async function fetchToursReport(siteUrl: string): Promise<ToursReport> {
  const url = `${siteUrl.replace(/\/$/, "")}/feeds/tours.json`;
  const res = await fetch(url, { headers: { "Accept-Encoding": "identity", Accept: "application/json" }, cache: "no-store", redirect: "error" });
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  if (!res.headers.get("x-feed-generated")) throw new Error(`${url} missing X-Feed-Generated - not the tours report`);
  return parseToursReport(await res.json());
}

/** The Activities rows of a report: each tour with its branded picture when it is drawn, else its own photo. Pure. */
export function toursActivityRows(report: ToursReport, brand: string, creativeOf: (item: ToursReportItem) => TourCreative | null): ActivityRow[] {
  return report.items.map((it) => {
    const creative = creativeOf(it);
    return {
      id: it.id,
      image_link: creative?.square || it.image,
      brand,
      description: it.description,
      title: it.title,
      price: it.price,
      link: it.link,
      // no ratings per tour, and none are invented (Mega Events publishes zeros too)
      rating_count: 0,
      user_rating: 0,
      activity_category: it.activity_category,
      performers: it.performers,
      location_names: it.location_names,
      activity_sub_categories: it.activity_sub_categories,
      activity_date: it.activity_date,
      custom_label_0: it.labels[0] ?? "",
      custom_label_1: it.labels[1] ?? "",
      custom_label_2: it.labels[2] ?? "",
      custom_label_3: it.labels[3] ?? "",
      custom_label_4: it.labels[4] ?? "",
    };
  });
}

async function upload(path: string, body: string, contentType: string): Promise<string> {
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, Buffer.from(body, "utf-8"), { contentType, cacheControl: "900", upsert: true });
  if (error) throw error;
  return supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Publishes one tours company's feed. `creativeOf` names the drawn pictures (lib/creative/tours.ts); the publish never
 * draws - the hourly creatives cron does, and "Sync now" draws before it publishes. Throws with a readable message.
 */
export async function publishToursFeed(
  company: FeedCompany,
  creativeOf: (item: ToursReportItem) => TourCreative | null,
  report?: ToursReport,
): Promise<PublishedToursReport> {
  if (!company.siteUrl) throw new Error(`${company.slug} has no site address`);
  const rep = report ?? (await fetchToursReport(company.siteUrl));
  const rows = toursActivityRows(rep, TOURS_FEED_BRAND[company.slug] ?? company.name, creativeOf);
  const csvUrl = await upload(toursFeedPath(company.slug), toActivitiesCsv(rows), "text/csv; charset=utf-8");
  const images: PublishedToursReport["images"] = {};
  for (const it of rep.items) {
    const c = creativeOf(it);
    images[it.id] = { image: c?.square || it.image, branded: !!c, banner: c?.banner ?? null };
  }
  const published: PublishedToursReport = { ...rep, publishedAt: new Date().toISOString(), csvUrl, images };
  await upload(toursReportPath(company.slug), JSON.stringify(published), "application/json; charset=utf-8");
  return published;
}

/** The last publish of a company, as Storage holds it (null before the first one). */
export async function readPublishedToursReport(slug: string): Promise<PublishedToursReport | null> {
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(toursReportPath(slug));
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text()) as PublishedToursReport;
  } catch {
    return null;
  }
}

/** Every tours company with a site: the companies whose feed the cron publishes. */
export async function listFeedCompanies(): Promise<FeedCompany[]> {
  const { data, error } = await supabase.from("companies").select("id, slug, name, site_url, product_types").contains("product_types", ["tours"]);
  if (error) throw new Error(`companies: ${error.message}`);
  // (companies is not in the generated types - lib/company.ts reads it the same way)
  const rows = (data ?? []) as unknown as { id: string; slug: string; name: string; site_url: string | null }[];
  return rows
    .filter((c) => typeof c.site_url === "string" && c.site_url)
    .map((c) => ({ id: String(c.id), slug: String(c.slug), name: String(c.name), siteUrl: String(c.site_url) }));
}
