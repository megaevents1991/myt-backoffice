"use server";

/**
 * Site content of a tours company (Mega Family): trip pages and their daily
 * itineraries, taxonomies, instructors, hotels and free content pages.
 *
 * The customer site is built from these rows. Every content row carries `data`,
 * the presentation object the site was originally built from; the site adapter
 * reads `data` and overlays the real columns. So a save here writes the column
 * AND the same field inside `data`, and never drops a `data` key it does not
 * edit. Only fields that actually changed are written.
 *
 * Nothing reaches the site until it is rebuilt - see lib/tours/site-publish.ts.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireCompany, type Company } from "@/lib/company";
import { toursDb } from "@/lib/tours/db";
import { logAudit } from "@/lib/audit";
import type { Database, Json } from "@/types/database.types";
import type {
  TourCmsPage,
  TourHotel,
  TourInstructor,
  TourItinerary,
  TourPackage,
  TourTerm,
} from "@/types/tours.types";
import {
  CMS_PAGE_KINDS,
  RESERVED_PAGE_ROOTS,
  type TermOption,
  PACKAGE_KINDS,
  TERM_KIND_DATA_KEY,
  type ActionResult,
  type CmsPageEditorData,
  type CmsPageForm,
  type CmsPageListRow,
  type FaqItem,
  type GalleryItem,
  type HotelEditorData,
  type HotelForm,
  type HotelList,
  type InstructorEditorData,
  type InstructorForm,
  type InstructorList,
  type LeaderOption,
  type NewTourContext,
  type TourHotelPick,
  type TourHotelStay,
  type ItineraryDay,
  type ItineraryInput,
  type ItineraryVariant,
  type ItineraryVariantInput,
  type PackageEditorData,
  type PackageForm,
  type PackageList,
  type TermEditorData,
  type TermForm,
  type TermKind,
  type TermListRow,
} from "@/components/tours/content/shared";
import { UUID, actionFail, fetchAll } from "@/lib/tours/action-kit";
import { catalogSlug } from "@/lib/tours/catalog";
import { asObject, companyAudit, invalidInput, type JsonObject } from "@/lib/tours/company-kit";
import {
  footerTilesSchema,
  homeSectionSchema,
  isSiteColor,
  isTermPageKind,
  readFooterTiles,
  readTermSections,
  termSectionsSchema,
} from "@/lib/tours/site-content";
import { EMPTY_EASY, PAGE_NOTES, cleanEasy, easyLayoutOfPath, leadersSiteText, readEasy, type EasyLayout, type EasyText } from "@/lib/tours/wp-html";
import { siteEditorOptions } from "@/lib/tours/site-options";
import { todayIso } from "@/lib/tours/format";

const failure = (e: unknown, fallback: string) => actionFail(e, "tours-content-actions", fallback);

type Tours = Database["tours"]["Tables"];

// ---------------------------------------------------------------- helpers
const asStrings = (value: Json | undefined): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

const blank = (value: unknown): boolean => value === null || value === undefined || value === "";
/** The value with every object's keys sorted: jsonb hands keys back in its own order, a form in another. */
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value;
const same = (a: unknown, b: unknown): boolean =>
  (blank(a) && blank(b)) || JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** "" -> null for a nullable text column. */
const orNull = (value: string): string | null => (value.trim() === "" ? null : value);

/** A string key of a `data` object, or "". */
const dataText = (data: JsonObject, key: string): string => {
  const value = data[key];
  return typeof value === "string" ? value : "";
};

/** Route folder of each term kind on the site (mega-family scripts/sync-content.mjs TERM_FOLDER). */
const TERM_SITE_FOLDER: Record<string, string> = {
  destinations: "destinations",
  audiences: "audience",
  tags: "product-tag",
  packages: "package",
  artists: "artists",
  villages: "villages",
  categories: "product-category",
};

/** A term as the tour editors pick it; an audience that is a world carries its key, its name and its color. */
const termOption = (t: { id: string; kind: string; name: string; is_active: boolean; data: Json }): TermOption => {
  const data = asObject(t.data);
  const key = dataText(data, "worldKey");
  return {
    id: t.id,
    kind: t.kind,
    name: t.name,
    isActive: t.is_active,
    ...(t.kind === "audiences" && key ? { world: { key, label: dataText(data, "brandName") || t.name, color: dataText(data, "color") } } : {}),
  };
};

/** An id that is not a uuid cannot match a row - answer "not found" instead of a database error. */
const isUuid = (value: string): boolean => UUID.test(value);

/** A long value in the audit trail says what changed, not the whole document. */
function brief(value: unknown): unknown {
  if (typeof value === "string") return value.length > 600 ? `${value.slice(0, 300)}… (${value.length} chars)` : value;
  if (value && typeof value === "object") {
    const size = JSON.stringify(value).length;
    if (size > 3000) return Array.isArray(value) ? `[${value.length} items, ${size} chars]` : `{${size} chars}`;
  }
  return value;
}

/**
 * Collects what a save actually changes: the columns, the matching keys of the
 * row's `data` and the audit diff. A field that did not change is not written.
 */
class RowPatch {
  columns: Record<string, unknown> = {};
  data: JsonObject = {};
  changes: Record<string, { from: unknown; to: unknown }> = {};

  /** `dataKey` = the camelCase name of the same field inside `data`, when it has one. */
  set(column: string, before: unknown, after: unknown, dataKey?: string, dataValue?: Json): boolean {
    if (same(before, after)) return false;
    this.columns[column] = after;
    this.changes[column] = { from: brief(before), to: brief(after) };
    if (dataKey) this.data[dataKey] = dataValue !== undefined ? dataValue : ((after ?? "") as Json);
    return true;
  }

  /** A field that lives only inside `data` (it has no column of its own). */
  setData(key: string, before: unknown, after: Json): boolean {
    if (same(before, after)) return false;
    this.data[key] = after;
    this.changes[key] = { from: brief(before), to: brief(after) };
    return true;
  }

  get dirty(): boolean {
    return Object.keys(this.columns).length > 0 || Object.keys(this.data).length > 0;
  }

  /** The update payload: changed columns, plus `data` with the changed keys merged in. */
  payload(currentData: Json): Record<string, unknown> {
    if (Object.keys(this.data).length === 0) return { ...this.columns };
    return { ...this.columns, data: { ...asObject(currentData), ...this.data } };
  }
}

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&#039;": "'",
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
};
const plainText = (html: string): string =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&(nbsp|amp|quot|#0?39|apos|lt|gt);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();

/**
 * The plain bullets of an HTML that is nothing but a list. The site prints the
 * "extra info" bullets from `data.extraInfo` and only falls back to the HTML
 * when that list is empty - so richer HTML answers [] and the HTML is shown.
 */
function bulletsOf(html: string): string[] {
  const items = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => m[1]);
  if (items.length === 0) return [];
  if (items.some((item) => /<[a-z]/i.test(item))) return [];
  const outside = plainText(html.replace(/<(ul|ol)\b[^>]*>[\s\S]*?<\/\1>/gi, " "));
  if (outside) return [];
  return items.map(plainText).filter(Boolean);
}

// ---------------------------------------------------------------- validation
const shortText = z.string().max(2000);
const htmlText = z.string().max(900_000, "The content is too long");
const textList = z.array(z.string().max(4000)).max(300);
const imagePath = z
  .string()
  .trim()
  .max(700)
  .refine((v) => v === "" || v.startsWith("/") || /^https?:\/\//i.test(v), "An image URL starts with /media/ or https://");
const cityCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^([A-Z]{3})?$/, "A city code is three English letters, e.g. LON");
const wholeNumber = z.number().int().min(0).max(100000);

const cleanList = (list: string[]): string[] => list.map((s) => s.trim()).filter(Boolean);

/** A hotel of a tour (the site's HotelStay). Keys this editor does not know are kept as they are. */
const hotelStaySchema = z
  .object({
    name: z.string().trim().min(1, "Every hotel needs a name").max(300),
    location: z.string().max(300),
    stars: z.number().int().min(1).max(7).nullable(),
    nights: z.string().max(60),
    image: imagePath,
    html: htmlText,
    board: z.string().max(200).optional(),
    dates: z.string().max(200).optional(),
    distance: z.string().max(200).optional(),
    amenities: textList.optional(),
    roomFeatures: textList.optional(),
    href: z.string().max(700).optional(),
    code: z.string().max(200).optional(),
  })
  .passthrough();

const cleanHotels = (hotels: z.infer<typeof hotelStaySchema>[]): TourHotelStay[] =>
  hotels.map((h) => ({
    ...h,
    name: h.name.trim(),
    location: h.location.trim(),
    nights: h.nights.trim(),
    image: h.image.trim(),
    ...(h.amenities ? { amenities: cleanList(h.amenities) } : {}),
    ...(h.roomFeatures ? { roomFeatures: cleanList(h.roomFeatures) } : {}),
  }));

const packageSchema = z.object({
  name: z.string().trim().min(1, "Page name is required").max(200),
  subtitle: shortText,
  slug: z
    .string()
    .trim()
    .min(1, "Page slug is required")
    .max(200)
    .regex(/^[^\s/?#%]+$/, "The page slug cannot contain spaces or the characters / ? # %"),
  kind: z.enum(PACKAGE_KINDS),
  // the tour's world: one of the built-in four, or the key of a world added in Categories & Tags
  brand: z.string().trim().min(1, "Choose the tour's world").max(60).regex(/^[a-zA-Z0-9_-]+$/, "Choose the tour's world"),
  days: z.number().int().min(0).max(365).nullable(),
  nights: z.number().int().min(0).max(365).nullable(),
  countries: shortText,
  seasons: textList,
  isActive: z.boolean(),
  heroImage: imagePath,
  cardImage: imagePath,
  gallery: z.array(imagePath).max(300),
  descriptionHtml: htmlText,
  attractions: textList,
  included: textList,
  notIncluded: textList,
  extraInfoHtml: htmlText,
  termsHtml: htmlText,
  cancellationHtml: htmlText,
  faq: z.array(z.object({ q: z.string().max(2000), aHtml: htmlText })).max(200),
  seoTitle: shortText,
  seoDescription: shortText,
  termIds: z.array(z.string().uuid()).max(1000),
  hotels: z.array(hotelStaySchema).max(40),
  leaderIds: z.array(z.string().uuid()).max(30),
});

const daySchema = z
  .object({
    n: z.number().int().min(1, "Day numbers start at 1").max(99),
    title: z.string().max(500),
    subtitle: z.string().max(1000),
    html: htmlText,
    image: imagePath.optional(),
  })
  .passthrough();

const itinerarySchema = z.object({
  label: z.string().trim().max(200),
  arrivalCity: cityCode,
  returnCity: cityCode,
  days: z.array(daySchema).max(60),
});

const variantSchema = z.object({
  sourceId: z.string().uuid(),
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "The variant ID is in English: lowercase letters, digits and hyphens (e.g. reverse)"),
  label: z.string().trim().min(1, "Variant name is required").max(200),
  arrivalCity: cityCode,
  returnCity: cityCode,
});

const termSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(300),
  descriptionHtml: htmlText,
  heroImages: z.array(imagePath).max(100),
  position: wholeNumber,
  isActive: z.boolean(),
  subtitle: z.string().trim().max(300),
  seoTitle: z.string().trim().max(300),
  brandName: z.string().trim().max(120),
  color: z.string().trim().max(40).refine((v) => v === "" || isSiteColor(v), "A color is #RRGGBB"),
  icon: imagePath,
  externalUrl: z.string().trim().max(600).refine((v) => v === "" || /^https?:\/\//i.test(v), "A link to another site starts with https://"),
  worldSlug: z.string().trim().max(200),
  // which parts a page may hold depends on the term's kind: checked in saveTourTerm (termSectionsSchema)
  sections: z.array(homeSectionSchema).max(20, "Up to 20 parts on a page"),
  footerTiles: footerTilesSchema,
});

const instructorSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(300),
  image: imagePath,
  regions: shortText,
  excerpt: z.string().max(20000),
  contentHtml: htmlText,
  gallery: z
    .array(z.object({ src: imagePath, title: z.string().max(500), caption: z.string().max(2000) }).passthrough())
    .max(200),
  position: wholeNumber,
  isActive: z.boolean(),
});

const hotelSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Hotel code is required")
    .max(200)
    .regex(/^\S+$/, "The hotel code cannot contain spaces"),
  name: z.string().trim().min(1, "Name is required").max(300),
  city: shortText,
  stars: z.number().int().min(1, "Star rating is between 1 and 5").max(5, "Star rating is between 1 and 5").nullable(),
  image: imagePath,
  gallery: z.array(imagePath).max(200),
  excerpt: z.string().max(20000),
  contentHtml: htmlText,
  amenities: textList,
});

const cmsPageSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(500),
  path: z.string().trim().max(300),
  excerpt: z.string().trim().max(1000),
  image: imagePath,
  date: z.string().trim().refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "The date is yyyy-mm-dd"),
  contentHtml: htmlText,
  seoTitle: shortText,
  seoDescription: shortText,
  isActive: z.boolean(),
  // the plain text of an imported page (lib/tours/wp-html.ts); ignored on a page made in the backoffice
  easy: z.object({
    body: htmlText,
    heading: z.string().trim().max(300),
    intro: z.string().max(40_000, "The opening text is too long"),
    faq: z
      .array(z.object({ q: z.string().trim().max(300, "A topic title is up to 300 characters"), a: z.string().max(120_000, "The text of a topic is too long") }))
      .max(60, "Up to 60 topics on a page"),
    heading2: z.string().trim().max(300),
    after: z.string().max(40_000, "The closing text is too long"),
    image: imagePath,
    imageAlt: z.string().trim().max(300),
  }),
  footerTiles: footerTilesSchema,
});

// ================================================================ trip pages
const toFaq = (value: Json): FaqItem[] =>
  Array.isArray(value)
    ? value.map((item) => {
        const o = asObject(item);
        return { q: typeof o.q === "string" ? o.q : "", aHtml: typeof o.aHtml === "string" ? o.aHtml : "" };
      })
    : [];

const OPTIONAL_HOTEL_TEXTS = ["board", "dates", "distance", "href", "code"] as const;
const OPTIONAL_HOTEL_LISTS = ["amenities", "roomFeatures"] as const;

/**
 * The stored hotels of a tour, every key kept (a save writes back what it
 * read). The fields the editor knows are made the type the save checks, so an
 * imported hotel with a number or a null in one of them never blocks a save.
 */
const toHotels = (value: Json): TourHotelStay[] =>
  Array.isArray(value)
    ? value.map((item) => {
        const o: Record<string, unknown> = { ...asObject(item) };
        for (const key of OPTIONAL_HOTEL_TEXTS) {
          if (o[key] === null || o[key] === undefined) delete o[key];
          else if (typeof o[key] !== "string") o[key] = String(o[key]);
        }
        for (const key of OPTIONAL_HOTEL_LISTS) {
          if (!Array.isArray(o[key])) delete o[key];
          else o[key] = (o[key] as unknown[]).filter((v): v is string => typeof v === "string");
        }
        const stars = typeof o.stars === "number" ? Math.trunc(o.stars) : Number(o.stars);
        return {
          ...o,
          name: typeof o.name === "string" ? o.name : "",
          location: typeof o.location === "string" ? o.location : "",
          stars: Number.isFinite(stars) && stars >= 1 && stars <= 7 ? stars : null,
          nights: typeof o.nights === "string" ? o.nights : typeof o.nights === "number" ? String(o.nights) : "",
          image: typeof o.image === "string" ? o.image : "",
          html: typeof o.html === "string" ? o.html : "",
        } as TourHotelStay;
      })
    : [];

const toDays = (value: Json): ItineraryDay[] =>
  Array.isArray(value)
    ? value.map((item, index) => {
        const o = asObject(item);
        return {
          ...(o as Record<string, unknown>),
          n: typeof o.n === "number" ? o.n : index + 1,
          title: typeof o.title === "string" ? o.title : "",
          subtitle: typeof o.subtitle === "string" ? o.subtitle : "",
          html: typeof o.html === "string" ? o.html : "",
          ...(typeof o.image === "string" && o.image ? { image: o.image } : {}),
        } as ItineraryDay;
      })
    : [];

const toVariant = (row: TourItinerary, departures: number): ItineraryVariant => ({
  id: row.id,
  key: row.key,
  label: row.label ?? "",
  arrivalCity: row.arrival_city ?? "",
  returnCity: row.return_city ?? "",
  days: toDays(row.days),
  departures,
});

function toPackageForm(pkg: TourPackage, termIds: string[]): PackageForm {
  const seo = asObject(pkg.seo);
  return {
    name: pkg.name,
    subtitle: pkg.subtitle ?? "",
    slug: pkg.slug,
    kind: pkg.kind,
    brand: pkg.brand,
    days: pkg.days,
    nights: pkg.nights,
    countries: pkg.countries ?? "",
    seasons: pkg.seasons ?? [],
    isActive: pkg.is_active,
    heroImage: pkg.hero_image ?? "",
    cardImage: pkg.card_image ?? "",
    gallery: pkg.gallery ?? [],
    descriptionHtml: pkg.description_html ?? "",
    attractions: pkg.attractions ?? [],
    included: pkg.included ?? [],
    notIncluded: pkg.not_included ?? [],
    extraInfoHtml: pkg.extra_info_html ?? "",
    termsHtml: pkg.terms_html ?? "",
    cancellationHtml: pkg.cancellation_html ?? "",
    faq: toFaq(pkg.faq),
    seoTitle: typeof seo.title === "string" ? seo.title : "",
    seoDescription: typeof seo.description === "string" ? seo.description : "",
    termIds,
    hotels: toHotels(pkg.hotels),
    leaderIds: pkg.instructor_ids ?? [],
  };
}

/** Everything the trip page editor shows. null = no such page in this company. */
async function loadPackageEditor(company: Company, id: string): Promise<PackageEditorData | null> {
  if (!isUuid(id)) return null;
  const db = toursDb();
  const { data: pkg, error } = await db
    .from("packages")
    .select("*")
    .eq("company_id", company.id)
    .eq("id", id)
    .is("is_deleted", null)
    .maybeSingle();
  if (error) throw error;
  if (!pkg) return null;

  const [itineraries, links, terms, series, departures, hotels, leaders] = await Promise.all([
    db.from("package_itineraries").select("*").eq("company_id", company.id).eq("package_id", id),
    db
      .from("package_terms")
      .select("term_id, terms!inner(company_id, kind)")
      .eq("package_id", id)
      .eq("terms.company_id", company.id),
    fetchAll((from, to) =>
      db
        .from("terms")
        .select("id, kind, name, is_active, data")
        .eq("company_id", company.id)
        .order("position")
        .order("name")
        .order("id")
        .range(from, to),
    ),
    db.from("series").select("code").eq("company_id", company.id).eq("package_id", id).order("code"),
    fetchAll((from, to) =>
      db
        .from("departures")
        .select("itinerary_id, updated_at")
        .eq("company_id", company.id)
        .eq("package_id", id)
        .order("id")
        .range(from, to),
    ),
    loadHotelCatalog(company),
    loadLeaderOptions(company),
  ]);
  for (const res of [itineraries, links, series]) if (res.error) throw res.error;

  const usage = new Map<string, number>();
  for (const d of departures) {
    if (d.itinerary_id) usage.set(d.itinerary_id, (usage.get(d.itinerary_id) ?? 0) + 1);
  }
  const variants = (itineraries.data ?? [])
    .map((row) => toVariant(row, usage.get(row.id) ?? 0))
    .sort((a, b) => (a.key === "main" ? -1 : b.key === "main" ? 1 : a.key.localeCompare(b.key)));
  if (!variants.some((v) => v.key === "main")) {
    variants.unshift({ id: null, key: "main", label: "מסלול ראשי", arrivalCity: "", returnCity: "", days: [], departures: 0 });
  }

  const termIds = (links.data ?? [])
    .filter((l) => (l.terms as unknown as { kind: string }).kind !== "packages")
    .map((l) => l.term_id);

  return {
    id: pkg.id,
    form: toPackageForm(pkg, termIds),
    hasContent: asObject(pkg.data).stub !== true,
    slugLocked: departures.length > 0,
    departures: departures.length,
    seriesCodes: (series.data ?? []).map((s) => s.code),
    itineraries: variants,
    terms: terms.map(termOption),
    hotelCatalog: hotels,
    leaderOptions: leaders,
    // the tour or one of its dates, whichever changed last
    updatedAt: departures.reduce(
      (latest, d) => (Date.parse(d.updated_at) > Date.parse(latest) ? d.updated_at : latest),
      pkg.updated_at,
    ),
    siteUrl: company.siteUrl,
  };
}

/** The company's group leaders, as a tour's leaders pick from them. */
async function loadLeaderOptions(company: Company): Promise<LeaderOption[]> {
  const rows = await fetchAll((from, to) =>
    toursDb()
      .from("instructors")
      .select("id, name, image, is_active")
      .eq("company_id", company.id)
      .order("name")
      .order("id")
      .range(from, to),
  );
  return rows.map((l) => ({ id: l.id, name: l.name, image: l.image, isActive: l.is_active }));
}

/** The company's hotel catalog, as the Hotels tab of a tour picks from it. */
async function loadHotelCatalog(company: Company): Promise<TourHotelPick[]> {
  const rows = await fetchAll((from, to) =>
    toursDb()
      .from("hotels")
      .select("id, code, name, city, stars, image, excerpt, content_html, amenities")
      .eq("company_id", company.id)
      .order("position")
      .order("name")
      .order("id")
      .range(from, to),
  );
  return rows.map((h) => ({
    id: h.id,
    code: h.code,
    name: h.name,
    city: h.city,
    stars: h.stars,
    image: h.image,
    excerpt: h.excerpt,
    contentHtml: h.content_html,
    amenities: h.amenities ?? [],
  }));
}

/** The trip pages of the company with what sells on each. */
export async function listTourPackages(): Promise<ActionResult<PackageList>> {
  try {
    const { company } = await requireCompany("tours");
    const db = toursDb();
    const [packages, series, departures] = await Promise.all([
      fetchAll((from, to) =>
        db
          .from("packages")
          .select("id, slug, name, subtitle, kind, brand, card_image, is_active, stub:data->stub")
          .eq("company_id", company.id)
          .is("is_deleted", null)
          .order("name")
          .order("id")
          .range(from, to),
      ),
      fetchAll((from, to) =>
        db.from("series").select("package_id, code").eq("company_id", company.id).order("code").order("id").range(from, to),
      ),
      fetchAll((from, to) =>
        db
          .from("departures")
          .select("package_id")
          .eq("company_id", company.id)
          .eq("is_published", true)
          .is("is_deleted", null)
          .gte("start_date", todayIso())
          .order("id")
          .range(from, to),
      ),
    ]);

    const codes = new Map<string, string[]>();
    for (const s of series) {
      if (!s.package_id) continue;
      codes.set(s.package_id, [...(codes.get(s.package_id) ?? []), s.code]);
    }
    const future = new Map<string, number>();
    for (const d of departures) future.set(d.package_id, (future.get(d.package_id) ?? 0) + 1);

    type Row = Pick<TourPackage, "id" | "slug" | "name" | "subtitle" | "kind" | "brand" | "card_image" | "is_active"> & {
      stub: Json;
    };
    const rows = (packages as unknown as Row[]).map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      subtitle: p.subtitle,
      kind: p.kind,
      brand: p.brand,
      cardImage: p.card_image,
      isActive: p.is_active,
      hasContent: p.stub !== true,
      seriesCodes: codes.get(p.id) ?? [],
      futurePublished: future.get(p.id) ?? 0,
    }));
    return { success: true, data: { rows, siteUrl: company.siteUrl } };
  } catch (e) {
    return failure(e, "Failed to load tour pages");
  }
}

export async function getTourPackage(id: string): Promise<ActionResult<PackageEditorData>> {
  try {
    const { company } = await requireCompany("tours");
    const data = await loadPackageEditor(company, id);
    if (!data) return { success: false, error: "Page not found" };
    return { success: true, data };
  } catch (e) {
    return failure(e, "Failed to load the page");
  }
}

type Badge = { icon?: string; label?: string };

/**
 * `data` also holds a few labels the importer derived from days / nights /
 * countries / season (the hero badges, the itinerary title). They are updated
 * only where they still say exactly what the old value produced - a label
 * someone worded by hand is left alone.
 */
function syncDerivedLabels(
  data: JsonObject,
  patch: RowPatch,
  before: TourPackage,
  after: { days: number | null; nights: number | null; countries: string | null; seasons: string[] },
): void {
  const badges = Array.isArray(data.badges) ? (data.badges as Badge[]).map((b) => ({ ...b })) : null;
  let badgesChanged = false;
  const relabel = (icon: string, from: string, to: string) => {
    const badge = badges?.find((b) => b.icon === icon && b.label === from);
    if (!badge) return;
    badge.label = to;
    badgesChanged = true;
  };

  if ("days" in patch.columns && before.days !== null && after.days !== null) {
    relabel("days", `${before.days} ימים`, `${after.days} ימים`);
    if (data.itineraryTitle === `מסלול הטיול | ${before.days} ימים`) {
      patch.data.itineraryTitle = `מסלול הטיול | ${after.days} ימים`;
    }
  }
  if ("nights" in patch.columns && before.nights !== null && after.nights !== null) {
    relabel("nights", `${before.nights} לילות`, `${after.nights} לילות`);
  }
  if ("countries" in patch.columns && before.countries && after.countries) {
    relabel("countries", before.countries, after.countries);
  }
  const oldSeason = before.seasons?.[0];
  const newSeason = after.seasons[0];
  if ("seasons" in patch.columns && oldSeason && newSeason && oldSeason !== newSeason) {
    if (data.seasonLabel === oldSeason) patch.data.seasonLabel = newSeason;
    const badge = badges?.find((b) => b.icon === "season" && typeof b.label === "string" && b.label.startsWith(`${oldSeason} `));
    if (badge?.label) {
      badge.label = newSeason + badge.label.slice(oldSeason.length);
      badgesChanged = true;
    }
  }
  if (badgesChanged && badges) patch.data.badges = badges as Json;
}

/** Save the trip page form. Writes each changed column and its key in `data`. */
export async function saveTourPackage(id: string, form: PackageForm): Promise<ActionResult<PackageEditorData>> {
  try {
    const { company } = await requireCompany("tours");
    const parsed = packageSchema.safeParse(form);
    if (!parsed.success) return invalidInput(parsed.error);
    const input = parsed.data;
    const db = toursDb();

    const { data: before, error } = await db
      .from("packages")
      .select("*")
      .eq("company_id", company.id)
      .eq("id", id)
      .is("is_deleted", null)
      .maybeSingle();
    if (error) throw error;
    if (!before) return { success: false, error: "Page not found" };
    const data = asObject(before.data);
    const patch = new RowPatch();

    // --- address: locked once departures sell on the page
    if (input.slug !== before.slug) {
      const { count, error: depError } = await db
        .from("departures")
        .select("id", { count: "exact", head: true })
        .eq("company_id", company.id)
        .eq("package_id", id);
      if (depError) throw depError;
      if ((count ?? 0) > 0) return { success: false, error: "The page already has departures, so its slug cannot change" };
      const { data: clash, error: clashError } = await db
        .from("packages")
        .select("id")
        .eq("company_id", company.id)
        .eq("slug", input.slug)
        .neq("id", id)
        .limit(1);
      if (clashError) throw clashError;
      if (clash && clash.length > 0) return { success: false, error: "A page with this slug already exists" };
      patch.set("slug", before.slug, input.slug, "slug");
      const oldPath = `/package/${before.slug}/`;
      const newPath = `/package/${input.slug}/`;
      if (data.path === oldPath) patch.data.path = newPath;
      if (data.cardHref === oldPath) patch.data.cardHref = newPath;
    }

    const seasons = cleanList(input.seasons);
    const countries = orNull(input.countries.trim());
    patch.set("name", before.name, input.name, "name");
    patch.set("subtitle", before.subtitle, orNull(input.subtitle.trim()), "subtitle");
    if (patch.set("kind", before.kind, input.kind) && input.kind !== "village") patch.data.template = input.kind;
    patch.set("brand", before.brand, input.brand, "brand");
    patch.set("days", before.days, input.days, "days", input.days);
    patch.set("nights", before.nights, input.nights, "nights", input.nights);
    patch.set("countries", before.countries, countries, "countries");
    patch.set("seasons", before.seasons, seasons, "seasons");
    patch.set("is_active", before.is_active, input.isActive);
    patch.set("hero_image", before.hero_image, orNull(input.heroImage), "heroImage");
    patch.set("card_image", before.card_image, orNull(input.cardImage), "cardImage");
    patch.set("gallery", before.gallery, cleanList(input.gallery), "gallery");
    patch.set("description_html", before.description_html, orNull(input.descriptionHtml), "descriptionHtml");
    patch.set("attractions", before.attractions, cleanList(input.attractions), "attractions");
    patch.set("included", before.included, cleanList(input.included), "included");
    patch.set("not_included", before.not_included, cleanList(input.notIncluded), "notIncluded");
    if (patch.set("extra_info_html", before.extra_info_html, orNull(input.extraInfoHtml), "extraInfoHtml")) {
      patch.data.extraInfo = bulletsOf(input.extraInfoHtml);
    }
    patch.set("terms_html", before.terms_html, orNull(input.termsHtml), "termsHtml");
    patch.set("cancellation_html", before.cancellation_html, orNull(input.cancellationHtml), "cancellationHtml");

    const faq = input.faq.map((f) => ({ q: f.q.trim(), aHtml: f.aHtml })).filter((f) => f.q || f.aHtml.trim());
    patch.set("faq", toFaq(before.faq), faq, "faq", faq);
    const hotels = cleanHotels(input.hotels);
    patch.set("hotels", toHotels(before.hotels), hotels, "hotels", hotels as unknown as Json);
    // group leaders: ids of this company's leaders only, in the chosen order
    const leaderIds = [...new Set(input.leaderIds)];
    if (leaderIds.length) {
      const { data: found, error: leadersError } = await db
        .from("instructors")
        .select("id")
        .eq("company_id", company.id)
        .in("id", leaderIds);
      if (leadersError) throw leadersError;
      if ((found ?? []).length !== leaderIds.length) return { success: false, error: "A group leader was not found in the active company" };
    }
    patch.set("instructor_ids", before.instructor_ids ?? [], leaderIds);

    const seoBefore = asObject(before.seo);
    const seoTitle = input.seoTitle.trim();
    const seoDescription = input.seoDescription.trim();
    if (!same(seoBefore.title, seoTitle) || !same(seoBefore.description, seoDescription)) {
      patch.set("seo", before.seo, { ...seoBefore, title: seoTitle, description: seoDescription });
      patch.data.seoTitle = seoTitle;
      patch.data.seoDescription = seoDescription;
    }

    syncDerivedLabels(data, patch, before, { days: input.days, nights: input.nights, countries, seasons });

    // --- attached terms (every kind but the page's own "packages" term)
    const [{ data: links, error: linksError }, terms] = await Promise.all([
      db.from("package_terms").select("term_id").eq("package_id", id),
      fetchAll((from, to) =>
        db.from("terms").select("id, kind, legacy_id").eq("company_id", company.id).order("id").range(from, to),
      ),
    ]);
    if (linksError) throw linksError;
    const termById = new Map(terms.map((t) => [t.id, t]));
    const editable = (termId: string) => {
      const term = termById.get(termId);
      return !!term && term.kind !== "packages";
    };
    const current = (links ?? []).map((l) => l.term_id).filter(editable);
    const wanted = [...new Set(input.termIds)].filter(editable);
    const toAdd = wanted.filter((t) => !current.includes(t));
    const toRemove = current.filter((t) => !wanted.includes(t));
    if (toAdd.length || toRemove.length) {
      const kinds = new Set([...toAdd, ...toRemove].map((t) => termById.get(t)?.kind ?? ""));
      for (const kind of kinds) {
        const key = TERM_KIND_DATA_KEY[kind as TermKind];
        if (!key) continue;
        const legacyIds = wanted
          .map((t) => termById.get(t))
          .filter((t) => t?.kind === kind)
          .map((t) => t?.legacy_id)
          .filter((n): n is number => typeof n === "number");
        // ascending, like the lists the site was built from
        patch.data[key] = [...new Set(legacyIds)].sort((x, y) => x - y);
      }
      patch.changes.terms = { from: current.length, to: wanted.length };
    }

    // --- a stub that received content becomes a real page: give the site the whole object
    const becomesPage =
      data.stub === true &&
      !!(orNull(input.descriptionHtml) || orNull(input.heroImage) || orNull(input.cardImage));
    let nextData: JsonObject | null = Object.keys(patch.data).length ? { ...data, ...patch.data } : null;
    if (becomesPage) {
      const path = `/package/${input.slug}/`;
      nextData = {
        path,
        cardHref: path,
        ...data,
        name: input.name,
        slug: input.slug,
        subtitle: input.subtitle.trim(),
        brand: input.brand,
        ...(input.kind !== "village" ? { template: input.kind } : {}),
        days: input.days,
        nights: input.nights,
        countries: countries ?? "",
        seasons,
        heroImage: input.heroImage,
        cardImage: input.cardImage,
        gallery: cleanList(input.gallery),
        descriptionHtml: input.descriptionHtml,
        attractions: cleanList(input.attractions),
        included: cleanList(input.included),
        notIncluded: cleanList(input.notIncluded),
        extraInfoHtml: input.extraInfoHtml,
        extraInfo: bulletsOf(input.extraInfoHtml),
        termsHtml: input.termsHtml,
        cancellationHtml: input.cancellationHtml,
        faq,
        seoTitle,
        seoDescription,
        ...patch.data,
      };
      delete nextData.stub;
      patch.changes.stub = { from: true, to: null };
    }

    if (Object.keys(patch.columns).length || nextData) {
      const payload = { ...patch.columns, ...(nextData ? { data: nextData } : {}) } as Tours["packages"]["Update"];
      const { error: updateError } = await db.from("packages").update(payload).eq("company_id", company.id).eq("id", id);
      if (updateError) throw updateError;
    }
    if (toRemove.length) {
      const { error: removeError } = await db.from("package_terms").delete().eq("package_id", id).in("term_id", toRemove);
      if (removeError) throw removeError;
    }
    if (toAdd.length) {
      const { error: addError } = await db
        .from("package_terms")
        .insert(toAdd.map((term_id) => ({ package_id: id, term_id })));
      if (addError) throw addError;
    }

    if (Object.keys(patch.changes).length) {
      await logAudit({
        action: "update",
        entityType: "tours_package",
        entityId: id,
        changes: patch.changes,
        metadata: { ...companyAudit(company), slug: before.slug },
      });
      revalidatePath("/tours/packages");
      revalidatePath(`/tours/packages/${id}`);
    }
    const fresh = await loadPackageEditor(company, id);
    if (!fresh) return { success: false, error: "Page not found" };
    return { success: true, data: fresh };
  } catch (e) {
    return failure(e, "Failed to save the page");
  }
}

/**
 * The hero badges of a new page, worded like the imported ones: "7 ימים",
 * "6 לילות", "2 מדינות", "חנוכה CBP". syncDerivedLabels keeps them in step
 * with later edits because they match its patterns.
 */
function derivedBadges(input: {
  days: number | null;
  nights: number | null;
  countries: string | null;
  season: string | undefined;
  code: string;
}): Badge[] {
  const badges: Badge[] = [];
  if (input.days) badges.push({ icon: "days", label: `${input.days} ימים` });
  if (input.nights) badges.push({ icon: "nights", label: `${input.nights} לילות` });
  if (input.countries) badges.push({ icon: "countries", label: input.countries });
  if (input.season) badges.push({ icon: "season", label: input.code ? `${input.season} ${input.code}` : input.season });
  return badges;
}

/**
 * A new tour page. The row starts with the keys of `data` that have no column
 * of their own (address, hero badges, dates box titles, the series code the card
 * shows), worded like the imported pages; then the regular page save writes
 * every column, the terms and their `data` keys. It starts inactive - the
 * Ready for the Site list on the tour page says what is missing before it goes
 * live.
 */
export async function createTourPackage(
  form: PackageForm,
  seriesCode: string | null,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { company } = await requireCompany("tours");
    const parsed = packageSchema.safeParse(form);
    if (!parsed.success) return invalidInput(parsed.error);
    const input = parsed.data;
    // A new vacation package would be priced per room by the site and show double; villages come from the old site.
    if (input.kind !== "organized") {
      return { success: false, error: "Only organized tours can be created here for now" };
    }
    const db = toursDb();
    // the slug is unique per company, deleted pages included
    const { data: clash, error: clashError } = await db
      .from("packages")
      .select("id, is_deleted")
      .eq("company_id", company.id)
      .eq("slug", input.slug)
      .limit(1);
    if (clashError) throw clashError;
    if (clash && clash.length > 0) {
      return {
        success: false,
        error: clash[0].is_deleted ? "A deleted tour used this slug. Choose another slug." : "A tour with this slug already exists",
      };
    }

    const code = (seriesCode ?? "").trim().toUpperCase();
    const seasons = cleanList(input.seasons);
    const countries = orNull(input.countries.trim());
    const path = `/package/${input.slug}/`;
    const data: JsonObject = {
      path,
      cardHref: path,
      code,
      template: input.kind,
      badges: derivedBadges({ days: input.days, nights: input.nights, countries, season: seasons[0], code }) as Json,
      datesTitle: "בחרו מתי תרצו לטוס?",
      datesNote: "מחיר לנוסע לפי הרכב של זוג. מחירים להרכבים נוספים מופיעים בשלב הבא.",
      datesPromo: "",
      seasonLabel: seasons[0] ?? "",
      itineraryTitle: input.days ? `מסלול הטיול | ${input.days} ימים` : "",
      extraInfo: bulletsOf(input.extraInfoHtml),
      extraSections: [],
      flights: [],
      vacation: null,
    };
    const { data: inserted, error } = await db
      .from("packages")
      .insert({
        company_id: company.id,
        slug: input.slug,
        name: input.name,
        kind: input.kind,
        brand: input.brand,
        is_active: false,
        data,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") return { success: false, error: "A tour with this slug already exists" };
      throw error;
    }
    await logAudit({
      action: "create",
      entityType: "tours_package",
      entityId: inserted.id,
      changes: { name: input.name, slug: input.slug, kind: input.kind },
      metadata: { ...companyAudit(company), slug: input.slug },
    });

    // every other field, the terms and their data keys: the same save the tour page runs
    const saved = await saveTourPackage(inserted.id, { ...form, isActive: false });
    revalidatePath("/tours/packages");
    if (!saved.success) {
      return { success: true, data: { id: inserted.id }, warning: `The tour was created, but its details were not all saved: ${saved.error}` };
    }
    return { success: true, data: { id: inserted.id } };
  } catch (e) {
    return failure(e, "Failed to create the tour");
  }
}

/** What the Create Tour screen offers: categories, the hotel catalog, the codes and slugs already taken. */
export async function getNewTourContext(): Promise<ActionResult<NewTourContext>> {
  try {
    const { company } = await requireCompany("tours");
    const db = toursDb();
    const [terms, hotels, series, slugs, leaders] = await Promise.all([
      fetchAll((from, to) =>
        db
          .from("terms")
          .select("id, kind, name, is_active, data")
          .eq("company_id", company.id)
          .order("position")
          .order("name")
          .order("id")
          .range(from, to),
      ),
      loadHotelCatalog(company),
      fetchAll((from, to) => db.from("series").select("code").eq("company_id", company.id).order("code").range(from, to)),
      fetchAll((from, to) => db.from("packages").select("slug").eq("company_id", company.id).order("slug").range(from, to)),
      loadLeaderOptions(company),
    ]);
    return {
      success: true,
      data: {
        siteUrl: company.siteUrl,
        terms: terms.map(termOption),
        hotels,
        leaders,
        seriesCodes: series.map((s) => s.code),
        slugs: slugs.map((p) => p.slug),
      },
    };
  } catch (e) {
    return failure(e, "Failed to load what a new tour needs");
  }
}

/**
 * Soft delete of a tour. A tour with dates can go only while nothing has been
 * sold on it and no date is on the site - a tour created by mistake. Then its
 * dates are soft-deleted with it, their flight links are released and its
 * series are switched off (a series code stays taken). `withDates` is the
 * operator's confirmation that the dates go too.
 */
export async function deleteTourPackage(id: string, withDates = false): Promise<ActionResult> {
  try {
    const { company } = await requireCompany("tours");
    const db = toursDb();
    const { data: pkg, error } = await db
      .from("packages")
      .select("id, slug, name")
      .eq("company_id", company.id)
      .eq("id", id)
      .is("is_deleted", null)
      .maybeSingle();
    if (error) throw error;
    if (!pkg) return { success: false, error: "Page not found" };

    const [series, departures] = await Promise.all([
      db.from("series").select("id").eq("company_id", company.id).eq("package_id", id),
      db.from("departures").select("id, is_published").eq("company_id", company.id).eq("package_id", id).is("is_deleted", null),
    ]);
    if (series.error) throw series.error;
    if (departures.error) throw departures.error;
    const dates = departures.data ?? [];
    const dateIds = dates.map((d) => d.id);
    if (dates.some((d) => d.is_published)) {
      return { success: false, error: "Some dates of this tour are on the site. Unpublish them first, or deactivate the tour instead" };
    }
    if (dateIds.length) {
      const { count, error: salesError } = await db
        .from("departure_sales_entries")
        .select("id", { count: "exact", head: true })
        .eq("company_id", company.id)
        .in("departure_id", dateIds)
        .is("is_deleted", null);
      if (salesError) throw salesError;
      if ((count ?? 0) > 0) return { success: false, error: "This tour has reservations. Deactivate it instead of deleting it" };
      if (!withDates) return { success: false, error: `The tour has ${dateIds.length} dates. Confirm that they are deleted with it` };
    }

    const today = todayIso();
    if (dateIds.length) {
      const { error: linksError } = await db.from("flight_allocations").delete().eq("company_id", company.id).in("departure_id", dateIds);
      if (linksError) throw linksError;
      const { error: datesError } = await db
        .from("departures")
        .update({ is_deleted: today, is_published: false })
        .eq("company_id", company.id)
        .in("id", dateIds);
      if (datesError) throw datesError;
    }
    const seriesIds = (series.data ?? []).map((s) => s.id);
    if (seriesIds.length) {
      const { error: seriesError } = await db.from("series").update({ is_active: false }).eq("company_id", company.id).in("id", seriesIds);
      if (seriesError) throw seriesError;
    }

    const { error: updateError } = await db
      .from("packages")
      .update({ is_deleted: todayIso(), is_active: false })
      .eq("company_id", company.id)
      .eq("id", id);
    if (updateError) throw updateError;
    await logAudit({
      action: "delete",
      entityType: "tours_package",
      entityId: id,
      changes: { dates_deleted: dateIds.length, series_switched_off: seriesIds.length },
      metadata: { ...companyAudit(company), slug: pkg.slug, name: pkg.name },
    });
    revalidatePath("/tours/packages");
    revalidatePath("/tours/departures");
    return { success: true, data: undefined };
  } catch (e) {
    return failure(e, "Failed to delete the tour");
  }
}

// ---------------------------------------------------------------- itineraries
const cleanDays = (days: z.infer<typeof daySchema>[]): Json =>
  days.map((day) => {
    const { image, ...rest } = day;
    return (image ? { ...rest, image } : rest) as Json;
  });

async function packageOf(company: Company, packageId: string): Promise<{ id: string; slug: string } | null> {
  if (!isUuid(packageId)) return null;
  const { data, error } = await toursDb()
    .from("packages")
    .select("id, slug")
    .eq("company_id", company.id)
    .eq("id", packageId)
    .is("is_deleted", null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Save one itinerary variant of a page. `itineraryId` null = the main variant
 * of a page that has no itinerary row yet: it is created.
 */
export async function saveTourItinerary(
  packageId: string,
  itineraryId: string | null,
  form: ItineraryInput,
): Promise<ActionResult<PackageEditorData>> {
  try {
    const { company } = await requireCompany("tours");
    const parsed = itinerarySchema.safeParse(form);
    if (!parsed.success) return invalidInput(parsed.error);
    const input = parsed.data;
    const db = toursDb();
    const pkg = await packageOf(company, packageId);
    if (!pkg) return { success: false, error: "Page not found" };

    const days = cleanDays(input.days);
    const arrival = input.arrivalCity || null;
    const back = input.returnCity || null;

    let query = db.from("package_itineraries").select("*").eq("company_id", company.id).eq("package_id", packageId);
    query = itineraryId ? query.eq("id", itineraryId) : query.eq("key", "main");
    const { data: before, error } = await query.maybeSingle();
    if (error) throw error;

    if (!before) {
      if (itineraryId) return { success: false, error: "Itinerary variant not found" };
      const { data: created, error: insertError } = await db
        .from("package_itineraries")
        .insert({
          company_id: company.id,
          package_id: packageId,
          key: "main",
          label: input.label || "מסלול ראשי",
          arrival_city: arrival,
          return_city: back,
          days,
        })
        .select("id")
        .single();
      if (insertError) throw insertError;
      await logAudit({
        action: "create",
        entityType: "tours_itinerary",
        entityId: created.id,
        changes: { key: "main", days: input.days.length },
        metadata: { ...companyAudit(company), package: pkg.slug },
      });
    } else {
      const patch = new RowPatch();
      patch.set("label", before.label, orNull(input.label));
      patch.set("arrival_city", before.arrival_city, arrival);
      patch.set("return_city", before.return_city, back);
      patch.set("days", before.days, days);
      if (patch.dirty) {
        const { error: updateError } = await db
          .from("package_itineraries")
          .update(patch.columns as Tours["package_itineraries"]["Update"])
          .eq("company_id", company.id)
          .eq("id", before.id);
        if (updateError) throw updateError;
        await logAudit({
          action: "update",
          entityType: "tours_itinerary",
          entityId: before.id,
          changes: patch.changes,
          metadata: { ...companyAudit(company), package: pkg.slug, key: before.key },
        });
      }
    }
    revalidatePath(`/tours/packages/${packageId}`);
    const fresh = await loadPackageEditor(company, packageId);
    if (!fresh) return { success: false, error: "Page not found" };
    return { success: true, data: fresh };
  } catch (e) {
    return failure(e, "Failed to save the itinerary");
  }
}

/** A new variant (the reversed route) opens as a copy of an existing one. */
export async function createTourItineraryVariant(
  packageId: string,
  form: ItineraryVariantInput,
): Promise<ActionResult<PackageEditorData>> {
  try {
    const { company } = await requireCompany("tours");
    const parsed = variantSchema.safeParse(form);
    if (!parsed.success) return invalidInput(parsed.error);
    const input = parsed.data;
    if (input.key === "main") return { success: false, error: "The ID main is reserved for the main itinerary" };
    const db = toursDb();
    const pkg = await packageOf(company, packageId);
    if (!pkg) return { success: false, error: "Page not found" };

    const { data: existing, error } = await db
      .from("package_itineraries")
      .select("id, key, days")
      .eq("company_id", company.id)
      .eq("package_id", packageId);
    if (error) throw error;
    const source = (existing ?? []).find((row) => row.id === input.sourceId);
    if (!source) return { success: false, error: "The variant to copy from was not found" };
    if ((existing ?? []).some((row) => row.key === input.key)) {
      return { success: false, error: "This page already has a variant with this ID" };
    }

    const { data: created, error: insertError } = await db
      .from("package_itineraries")
      .insert({
        company_id: company.id,
        package_id: packageId,
        key: input.key,
        label: input.label,
        arrival_city: input.arrivalCity || null,
        return_city: input.returnCity || null,
        days: source.days,
      })
      .select("id")
      .single();
    if (insertError) throw insertError;
    await logAudit({
      action: "create",
      entityType: "tours_itinerary",
      entityId: created.id,
      changes: { key: input.key, label: input.label, copied_from: source.key },
      metadata: { ...companyAudit(company), package: pkg.slug },
    });
    revalidatePath(`/tours/packages/${packageId}`);
    const fresh = await loadPackageEditor(company, packageId);
    if (!fresh) return { success: false, error: "Page not found" };
    return { success: true, data: fresh };
  } catch (e) {
    return failure(e, "Failed to create the variant");
  }
}

/** Remove a variant. The main one stays, and so does a variant departures point at. */
export async function deleteTourItineraryVariant(
  packageId: string,
  itineraryId: string,
): Promise<ActionResult<PackageEditorData>> {
  try {
    const { company } = await requireCompany("tours");
    const db = toursDb();
    const { data: row, error } = await db
      .from("package_itineraries")
      .select("id, key, label")
      .eq("company_id", company.id)
      .eq("package_id", packageId)
      .eq("id", itineraryId)
      .maybeSingle();
    if (error) throw error;
    if (!row) return { success: false, error: "Itinerary variant not found" };
    if (row.key === "main") return { success: false, error: "The main itinerary cannot be deleted" };

    const { count, error: countError } = await db
      .from("departures")
      .select("id", { count: "exact", head: true })
      .eq("company_id", company.id)
      .eq("itinerary_id", itineraryId);
    if (countError) throw countError;
    if ((count ?? 0) > 0) {
      return { success: false, error: `Departures use this variant (${count}). Move them to another variant before deleting it` };
    }
    const { data: usingSeasons, error: seasonsError } = await db
      .from("package_seasons")
      .select("name")
      .eq("company_id", company.id)
      .eq("itinerary_id", itineraryId);
    if (seasonsError) throw seasonsError;
    if (usingSeasons && usingSeasons.length > 0) {
      return {
        success: false,
        error: `The season "${usingSeasons.map((s) => s.name).join('", "')}" runs this variant. Give the season another itinerary (Seasons tab) before deleting it`,
      };
    }

    const { error: deleteError } = await db
      .from("package_itineraries")
      .delete()
      .eq("company_id", company.id)
      .eq("id", itineraryId);
    if (deleteError) throw deleteError;
    await logAudit({
      action: "delete",
      entityType: "tours_itinerary",
      entityId: itineraryId,
      metadata: { ...companyAudit(company), package_id: packageId, key: row.key, label: row.label },
    });
    revalidatePath(`/tours/packages/${packageId}`);
    const fresh = await loadPackageEditor(company, packageId);
    if (!fresh) return { success: false, error: "Page not found" };
    return { success: true, data: fresh };
  } catch (e) {
    return failure(e, "Failed to delete the variant");
  }
}

// ================================================================ taxonomies
export async function listTourTerms(): Promise<ActionResult<TermListRow[]>> {
  try {
    const { company } = await requireCompany("tours");
    const db = toursDb();
    const [terms, links] = await Promise.all([
      fetchAll((from, to) =>
        db
          .from("terms")
          .select("id, kind, slug, name, position, is_active, hero_images")
          .eq("company_id", company.id)
          .order("position")
          .order("name")
          .order("id")
          .range(from, to),
      ),
      fetchAll((from, to) =>
        db
          .from("package_terms")
          .select("term_id, packages!inner(company_id, is_deleted)")
          .eq("packages.company_id", company.id)
          .is("packages.is_deleted", null)
          .order("package_id")
          .order("term_id")
          .range(from, to),
      ),
    ]);
    const pages = new Map<string, number>();
    for (const l of links) pages.set(l.term_id, (pages.get(l.term_id) ?? 0) + 1);
    return {
      success: true,
      data: terms.map((t) => ({
        id: t.id,
        kind: t.kind,
        slug: t.slug,
        name: t.name,
        position: t.position,
        isActive: t.is_active,
        pages: pages.get(t.id) ?? 0,
        heroImages: (t.hero_images ?? []).length,
      })),
    };
  } catch (e) {
    return failure(e, "Failed to load categories and tags");
  }
}

async function loadTerm(company: Company, id: string): Promise<{ row: TourTerm; editor: TermEditorData } | null> {
  if (!isUuid(id)) return null;
  const db = toursDb();
  const { data: row, error } = await db.from("terms").select("*").eq("company_id", company.id).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!row) return null;
  const { data: links, error: linksError } = await db
    .from("package_terms")
    .select("package_id, packages!inner(id, name, company_id, is_deleted)")
    .eq("term_id", id)
    .eq("packages.company_id", company.id)
    .is("packages.is_deleted", null);
  if (linksError) throw linksError;
  const pages = (links ?? [])
    .map((l) => l.packages as unknown as { id: string; name: string })
    .sort((a, b) => a.name.localeCompare(b.name, "he"));
  // the worlds a tag can belong to
  const { data: worlds, error: worldsError } =
    row.kind === "tags"
      ? await db.from("terms").select("slug, name").eq("company_id", company.id).eq("kind", "audiences").eq("is_active", true).order("position").order("name")
      : { data: [], error: null };
  if (worldsError) throw worldsError;
  const data = asObject(row.data);
  // the page of a destination, a world, a tag or a category is built from sections; their pickers need the company's tours, terms and pages
  const options = isTermPageKind(row.kind) ? await siteEditorOptions(company) : null;
  return {
    row,
    editor: {
      id: row.id,
      kind: row.kind,
      slug: row.slug,
      form: {
        name: row.name,
        descriptionHtml: row.description_html ?? "",
        heroImages: row.hero_images ?? [],
        position: row.position,
        isActive: row.is_active,
        subtitle: dataText(data, "subtitle"),
        seoTitle: dataText(data, "seoTitle"),
        brandName: dataText(data, "brandName"),
        color: dataText(data, "color"),
        icon: dataText(data, "icon"),
        externalUrl: dataText(data, "externalUrl"),
        worldSlug: dataText(data, "worldSlug"),
        sections: isTermPageKind(row.kind) ? readTermSections(row.kind, data.sections) : [],
        footerTiles: readFooterTiles(data.footerTiles),
      },
      pages,
      worlds: worlds ?? [],
      options,
      path: dataText(data, "path") || `/${TERM_SITE_FOLDER[row.kind] ?? row.kind}/${row.slug}/`,
      siteUrl: company.siteUrl,
    },
  };
}

export async function getTourTerm(id: string): Promise<ActionResult<TermEditorData>> {
  try {
    const { company } = await requireCompany("tours");
    const loaded = await loadTerm(company, id);
    if (!loaded) return { success: false, error: "Category or tag not found" };
    return { success: true, data: loaded.editor };
  } catch (e) {
    return failure(e, "Failed to load the category or tag");
  }
}

export async function saveTourTerm(id: string, form: TermForm): Promise<ActionResult<TermEditorData>> {
  try {
    const { company } = await requireCompany("tours");
    const parsed = termSchema.safeParse(form);
    if (!parsed.success) return invalidInput(parsed.error);
    const input = parsed.data;
    const loaded = await loadTerm(company, id);
    if (!loaded) return { success: false, error: "Category or tag not found" };
    const before = loaded.row;

    const patch = new RowPatch();
    patch.set("name", before.name, input.name, "name");
    if (patch.set("description_html", before.description_html, orNull(input.descriptionHtml), "descriptionHtml")) {
      // the site's meta description is the plain text of the same field
      patch.data.description = plainText(input.descriptionHtml);
    }
    patch.set("hero_images", before.hero_images, cleanList(input.heroImages), "heroImages");
    patch.set("position", before.position, input.position);
    patch.set("is_active", before.is_active, input.isActive);
    // what has no column lives in `data`, which the site reads as part of the term
    const stored = asObject(before.data);
    patch.setData("subtitle", dataText(stored, "subtitle"), input.subtitle);
    // an emptied title goes back to the site's own wording ("<name> Archives - <site>")
    if (input.seoTitle !== "" || dataText(stored, "seoTitle") !== "") patch.setData("seoTitle", dataText(stored, "seoTitle"), input.seoTitle);
    if (before.kind === "audiences") {
      patch.setData("brandName", dataText(stored, "brandName"), input.brandName);
      patch.setData("color", dataText(stored, "color"), input.color);
      patch.setData("icon", dataText(stored, "icon"), input.icon);
      patch.setData("externalUrl", dataText(stored, "externalUrl"), input.externalUrl);
      // the key the tours of this world carry; given once, when the audience becomes a world
      if (!dataText(stored, "worldKey") && (input.brandName || input.color)) {
        patch.setData("worldKey", "", `world_${before.id.replace(/-/g, "").slice(0, 10)}`);
      }
    }
    if (before.kind === "tags") patch.setData("worldSlug", dataText(stored, "worldSlug"), input.worldSlug);
    if (isTermPageKind(before.kind)) {
      // The page as staff arranged it. A page they never touched compares equal to its default
      // layout, so nothing is stored for it and the site keeps drawing it the way it always did.
      const page = termSectionsSchema(before.kind).safeParse(input.sections);
      if (!page.success) return invalidInput(page.error);
      patch.setData("sections", readTermSections(before.kind, stored.sections) as unknown as Json, page.data as unknown as Json);
    }
    patch.setData("footerTiles", readFooterTiles(stored.footerTiles) as unknown as Json, input.footerTiles as unknown as Json);

    if (patch.dirty) {
      const { error } = await toursDb()
        .from("terms")
        .update(patch.payload(before.data) as Tours["terms"]["Update"])
        .eq("company_id", company.id)
        .eq("id", id);
      if (error) throw error;
      await logAudit({
        action: "update",
        entityType: "tours_term",
        entityId: id,
        changes: patch.changes,
        metadata: { ...companyAudit(company), kind: before.kind, slug: before.slug },
      });
      revalidatePath("/tours/terms");
      revalidatePath(`/tours/terms/${id}`);
    }
    const fresh = await loadTerm(company, id);
    if (!fresh) return { success: false, error: "Category or tag not found" };
    return { success: true, data: fresh.editor };
  } catch (e) {
    return failure(e, "Failed to save the category or tag");
  }
}

// ================================================================ instructors
const toGallery = (value: Json): GalleryItem[] =>
  Array.isArray(value)
    ? value.map((item) => {
        const o = asObject(item);
        return {
          ...(o as Record<string, unknown>),
          src: typeof o.src === "string" ? o.src : "",
          title: typeof o.title === "string" ? o.title : "",
          caption: typeof o.caption === "string" ? o.caption : "",
        } as GalleryItem;
      })
    : [];

const instructorEditor = (company: Company, row: TourInstructor): InstructorEditorData => ({
  id: row.id,
  slug: row.slug,
  form: {
    name: row.name,
    image: row.image ?? "",
    regions: row.regions ?? "",
    excerpt: row.excerpt ?? "",
    contentHtml: row.content_html ?? "",
    gallery: toGallery(row.gallery),
    position: row.position,
    isActive: row.is_active,
  },
  siteUrl: company.siteUrl,
});

export async function listTourInstructors(): Promise<ActionResult<InstructorList>> {
  try {
    const { company } = await requireCompany("tours");
    const data = await fetchAll((from, to) =>
      toursDb()
        .from("instructors")
        .select("id, slug, name, image, regions, position, is_active")
        .eq("company_id", company.id)
        .order("position")
        .order("name")
        .order("id")
        .range(from, to),
    );
    return {
      success: true,
      data: {
        rows: data.map((r) => ({
          id: r.id,
          slug: r.slug,
          name: r.name,
          image: r.image,
          regions: r.regions,
          position: r.position,
          isActive: r.is_active,
        })),
        siteUrl: company.siteUrl,
      },
    };
  } catch (e) {
    return failure(e, "Failed to load group leaders");
  }
}

async function instructorRow(company: Company, id: string): Promise<TourInstructor | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await toursDb()
    .from("instructors")
    .select("*")
    .eq("company_id", company.id)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getTourInstructor(id: string): Promise<ActionResult<InstructorEditorData>> {
  try {
    const { company } = await requireCompany("tours");
    const row = await instructorRow(company, id);
    if (!row) return { success: false, error: "Group leader not found" };
    return { success: true, data: instructorEditor(company, row) };
  } catch (e) {
    return failure(e, "Failed to load the group leader");
  }
}

export async function saveTourInstructor(
  id: string,
  form: InstructorForm,
): Promise<ActionResult<InstructorEditorData>> {
  try {
    const { company } = await requireCompany("tours");
    const parsed = instructorSchema.safeParse(form);
    if (!parsed.success) return invalidInput(parsed.error);
    const input = parsed.data;
    const before = await instructorRow(company, id);
    if (!before) return { success: false, error: "Group leader not found" };

    const gallery = input.gallery.filter((g) => g.src) as unknown as Json;
    const patch = new RowPatch();
    patch.set("name", before.name, input.name, "name");
    patch.set("image", before.image, orNull(input.image), "image");
    patch.set("regions", before.regions, orNull(input.regions.trim()), "regions");
    patch.set("excerpt", before.excerpt, orNull(input.excerpt), "excerpt");
    patch.set("content_html", before.content_html, orNull(input.contentHtml), "contentHtml");
    patch.set("gallery", before.gallery, gallery, "gallery", gallery);
    patch.set("position", before.position, input.position);
    patch.set("is_active", before.is_active, input.isActive);

    if (patch.dirty) {
      const { error } = await toursDb()
        .from("instructors")
        .update(patch.payload(before.data) as Tours["instructors"]["Update"])
        .eq("company_id", company.id)
        .eq("id", id);
      if (error) throw error;
      await logAudit({
        action: "update",
        entityType: "tours_instructor",
        entityId: id,
        changes: patch.changes,
        metadata: { ...companyAudit(company), slug: before.slug },
      });
      revalidatePath("/tours/instructors");
      revalidatePath(`/tours/instructors/${id}`);
    }
    const fresh = await instructorRow(company, id);
    if (!fresh) return { success: false, error: "Group leader not found" };
    return { success: true, data: instructorEditor(company, fresh) };
  } catch (e) {
    return failure(e, "Failed to save the group leader");
  }
}

// ================================================================ hotels
async function hotelRow(company: Company, id: string): Promise<TourHotel | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await toursDb().from("hotels").select("*").eq("company_id", company.id).eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

async function hotelEditor(company: Company, row: TourHotel): Promise<HotelEditorData> {
  const { count, error } = await toursDb()
    .from("departure_options")
    .select("id", { count: "exact", head: true })
    .eq("company_id", company.id)
    .eq("kind", "hotel")
    .eq("ref_code", row.code);
  if (error) throw error;
  return {
    id: row.id,
    slug: row.slug,
    form: {
      code: row.code,
      name: row.name,
      city: row.city ?? "",
      stars: row.stars,
      image: row.image ?? "",
      gallery: asStrings(row.gallery),
      excerpt: row.excerpt ?? "",
      contentHtml: row.content_html ?? "",
      amenities: row.amenities ?? [],
    },
    optionsUsingCode: count ?? 0,
    siteUrl: company.siteUrl,
  };
}

export async function listTourHotels(): Promise<ActionResult<HotelList>> {
  try {
    const { company } = await requireCompany("tours");
    const rows = await fetchAll((from, to) =>
      toursDb()
        .from("hotels")
        .select("id, code, name, city, stars, image, position")
        .eq("company_id", company.id)
        .order("position")
        .order("name")
        .order("id")
        .range(from, to),
    );
    return { success: true, data: { rows, siteUrl: company.siteUrl } };
  } catch (e) {
    return failure(e, "Failed to load hotels");
  }
}

export async function getTourHotel(id: string): Promise<ActionResult<HotelEditorData>> {
  try {
    const { company } = await requireCompany("tours");
    const row = await hotelRow(company, id);
    if (!row) return { success: false, error: "Hotel not found" };
    return { success: true, data: await hotelEditor(company, row) };
  } catch (e) {
    return failure(e, "Failed to load the hotel");
  }
}

export async function saveTourHotel(id: string, form: HotelForm): Promise<ActionResult<HotelEditorData>> {
  try {
    const { company } = await requireCompany("tours");
    const parsed = hotelSchema.safeParse(form);
    if (!parsed.success) return invalidInput(parsed.error);
    const input = parsed.data;
    const db = toursDb();
    const before = await hotelRow(company, id);
    if (!before) return { success: false, error: "Hotel not found" };

    // The code is what a departure's hotel option points at - it cannot move under one.
    if (input.code !== before.code) {
      const [used, clash] = await Promise.all([
        db
          .from("departure_options")
          .select("id", { count: "exact", head: true })
          .eq("company_id", company.id)
          .eq("kind", "hotel")
          .eq("ref_code", before.code),
        db.from("hotels").select("id").eq("company_id", company.id).eq("code", input.code).neq("id", id).limit(1),
      ]);
      if (used.error) throw used.error;
      if (clash.error) throw clash.error;
      if ((used.count ?? 0) > 0) {
        return { success: false, error: `Departure options point to this code (${used.count}), so it cannot change` };
      }
      if (clash.data && clash.data.length > 0) return { success: false, error: "A hotel with this code already exists" };
    }

    const gallery = cleanList(input.gallery);
    const patch = new RowPatch();
    patch.set("code", before.code, input.code);
    patch.set("name", before.name, input.name, "name");
    patch.set("city", before.city, orNull(input.city.trim()));
    patch.set("stars", before.stars, input.stars);
    patch.set("image", before.image, orNull(input.image), "image");
    // the site object calls the hotel gallery "images"
    patch.set("gallery", asStrings(before.gallery), gallery, "images", gallery);
    patch.set("excerpt", before.excerpt, orNull(input.excerpt), "excerpt");
    patch.set("content_html", before.content_html, orNull(input.contentHtml), "contentHtml");
    patch.set("amenities", before.amenities, cleanList(input.amenities));

    if (patch.dirty) {
      const { error } = await db
        .from("hotels")
        .update(patch.payload(before.data) as Tours["hotels"]["Update"])
        .eq("company_id", company.id)
        .eq("id", id);
      if (error) throw error;
      await logAudit({
        action: "update",
        entityType: "tours_hotel",
        entityId: id,
        changes: patch.changes,
        metadata: { ...companyAudit(company), code: before.code },
      });
      revalidatePath("/tours/hotels");
      revalidatePath(`/tours/hotels/${id}`);
    }
    const fresh = await hotelRow(company, id);
    if (!fresh) return { success: false, error: "Hotel not found" };
    return { success: true, data: await hotelEditor(company, fresh) };
  } catch (e) {
    return failure(e, "Failed to save the hotel");
  }
}

// ================================================================ content pages
/** An imported page has a plain editor for its words; a page or post made in the backoffice never needs one. */
const easyLayoutOf = (row: TourCmsPage): EasyLayout | null => (isCreatedPage(row) || row.kind !== "page" ? null : easyLayoutOfPath(row.path));

/**
 * The words the site keeps outside a page's own markup, which its plain editor opens with:
 * the leaders page reads them from the "extras" row of the import. Every other page has none.
 */
async function siteTextOf(company: Company, row: TourCmsPage): Promise<Partial<EasyText>> {
  if (easyLayoutOf(row) !== "leaders") return {};
  const { data, error } = await toursDb().from("cms_pages").select("data").eq("company_id", company.id).eq("kind", "extras").limit(1);
  if (error) throw error;
  return leadersSiteText(data?.[0]?.data);
}

const cmsPageEditor = (company: Company, row: TourCmsPage, siteText: Partial<EasyText>): Omit<CmsPageEditorData, "options"> => {
  // the import left the SEO fields inside `data`; the column wins once it is filled
  const column = asObject(row.seo);
  const original = asObject(asObject(row.data).seo);
  const pick = (key: string): string => {
    const value = column[key] ?? original[key];
    return typeof value === "string" ? value : "";
  };
  const data = asObject(row.data);
  const easyLayout = easyLayoutOf(row);
  return {
    id: row.id,
    kind: row.kind,
    path: row.path,
    form: {
      title: row.title,
      path: row.path,
      contentHtml: row.content_html ?? "",
      excerpt: dataText(data, "excerpt"),
      image: dataText(data, "image"),
      // WordPress kept a full timestamp; the editor works with the day
      date: dataText(data, "date").slice(0, 10),
      seoTitle: pick("title"),
      seoDescription: pick("description"),
      isActive: row.is_active,
      easy: easyLayout ? readEasy(easyLayout, data.easy, row.content_html ?? "", siteText) : EMPTY_EASY,
      footerTiles: readFooterTiles(data.footerTiles),
    },
    created: isCreatedPage(row),
    easyLayout,
    note: isCreatedPage(row) || row.kind !== "page" ? null : (PAGE_NOTES[row.path] ?? null),
    siteUrl: company.siteUrl,
  };
};

/** A page made in the backoffice: the site draws it with the general template (mega-family app/[...slug]). */
const isCreatedPage = (row: TourCmsPage): boolean => dataText(asObject(row.data), "template") === "cms";

/**
 * The address of a content page as the site serves it: "/name/" or
 * "/part/name/". Refuses what would shadow one of the site's own routes.
 */
function pagePath(raw: string): { path: string } | { error: string } {
  const segments = raw
    .trim()
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return { error: "Enter the page address, e.g. /summer-tips/" };
  if (segments.length > 3) return { error: "A page address has up to three parts" };
  if (segments.some((s) => /[\s?#%&\\]/.test(s) || s.length > 100)) {
    return { error: "A page address has no spaces and none of ? # % & \\ - use a hyphen between words" };
  }
  if (RESERVED_PAGE_ROOTS.includes(segments[0].toLowerCase())) {
    return { error: `An address cannot start with /${segments[0]}/ - the site keeps it for its own pages` };
  }
  return { path: `/${segments.join("/")}/` };
}

async function cmsPageRow(company: Company, id: string): Promise<TourCmsPage | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await toursDb()
    .from("cms_pages")
    .select("*")
    .eq("company_id", company.id)
    .eq("id", id)
    .in("kind", [...CMS_PAGE_KINDS])
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listTourCmsPages(): Promise<ActionResult<CmsPageListRow[]>> {
  try {
    const { company } = await requireCompany("tours");
    const db = toursDb();
    const [pages, empty] = await Promise.all([
      fetchAll((from, to) =>
        db
          .from("cms_pages")
          .select("id, kind, path, title, position, is_active")
          .eq("company_id", company.id)
          .in("kind", [...CMS_PAGE_KINDS])
          .order("kind")
          .order("position")
          .order("id")
          .range(from, to),
      ),
      fetchAll((from, to) =>
        db
          .from("cms_pages")
          .select("id")
          .eq("company_id", company.id)
          .in("kind", [...CMS_PAGE_KINDS])
          .or("content_html.is.null,content_html.eq.")
          .order("id")
          .range(from, to),
      ),
    ]);
    const noContent = new Set(empty.map((r) => r.id));
    return {
      success: true,
      // an address of the old WordPress shop is not a page of the site: the list leaves it out
      data: pages
        .filter((r) => !(r.kind === "page" && PAGE_NOTES[r.path]?.retired))
        .map((r) => ({
        id: r.id,
        kind: r.kind,
        path: r.path,
        title: r.title,
        position: r.position,
        isActive: r.is_active,
        hasContent: !noContent.has(r.id),
      })),
    };
  } catch (e) {
    return failure(e, "Failed to load content pages");
  }
}

export async function getTourCmsPage(id: string): Promise<ActionResult<CmsPageEditorData>> {
  try {
    const { company } = await requireCompany("tours");
    const row = await cmsPageRow(company, id);
    if (!row) return { success: false, error: "Page not found" };
    const [siteText, options] = await Promise.all([siteTextOf(company, row), siteEditorOptions(company)]);
    return { success: true, data: { ...cmsPageEditor(company, row, siteText), options } };
  } catch (e) {
    return failure(e, "Failed to load the page");
  }
}

const newPageSchema = z.object({
  kind: z.enum(CMS_PAGE_KINDS),
  title: z.string().trim().min(1, "Title is required").max(500),
});

/**
 * A new content page or blog post. It starts switched off and empty, at an
 * address made from its title; the editor fills it and switches it on. The
 * site serves every such page from one general template, so nothing has to be
 * built for it.
 */
export async function createTourCmsPage(input: { kind: string; title: string }): Promise<ActionResult<{ id: string }>> {
  try {
    const { company } = await requireCompany("tours");
    const parsed = newPageSchema.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error);
    const { kind, title } = parsed.data;
    const db = toursDb();

    const taken = await fetchAll((from, to) =>
      db.from("cms_pages").select("path, position").eq("company_id", company.id).order("id").range(from, to),
    );
    const paths = new Set(taken.map((row) => row.path));
    const base = catalogSlug(title) || (kind === "post" ? "post" : "page");
    const root = RESERVED_PAGE_ROOTS.includes(base.toLowerCase()) ? `${base}-page` : base;
    let slug = root;
    for (let n = 2; paths.has(`/${slug}/`); n++) slug = `${root}-${n}`;
    const path = `/${slug}/`;
    const today = todayIso();

    const { data: inserted, error } = await db
      .from("cms_pages")
      .insert({
        company_id: company.id,
        kind,
        path,
        title,
        content_html: null,
        seo: {},
        position: taken.reduce((max, row) => Math.max(max, row.position), 0) + 1,
        legacy_id: null,
        // `template: "cms"` marks a page made here; the rest is what the site's page type expects
        data: { template: "cms", slug, path, title, date: today, modified: today, excerpt: "", image: "", parent: 0, seo: { title: "", description: "" } },
        is_active: false,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") return { success: false, error: "A page with this address already exists - try again" };
      throw error;
    }
    await logAudit({
      action: "create",
      entityType: "tours_cms_page",
      entityId: inserted.id,
      metadata: { ...companyAudit(company), kind, path, title },
    });
    revalidatePath("/tours/pages");
    return { success: true, data: { id: inserted.id } };
  } catch (e) {
    return failure(e, "Failed to create the page");
  }
}

export async function saveTourCmsPage(id: string, form: CmsPageForm): Promise<ActionResult<CmsPageEditorData>> {
  try {
    const { company } = await requireCompany("tours");
    const parsed = cmsPageSchema.safeParse(form);
    if (!parsed.success) return invalidInput(parsed.error);
    const input = parsed.data;
    const before = await cmsPageRow(company, id);
    if (!before) return { success: false, error: "Page not found" };
    const siteText = await siteTextOf(company, before);
    const shown = cmsPageEditor(company, before, siteText).form;

    const patch = new RowPatch();
    patch.set("title", before.title, input.title, "title");
    patch.set("content_html", before.content_html, orNull(input.contentHtml), "contentHtml");
    patch.set("is_active", before.is_active, input.isActive);
    const stored = asObject(before.data);
    patch.setData("excerpt", dataText(stored, "excerpt"), input.excerpt);
    patch.setData("image", dataText(stored, "image"), input.image);
    // the day only; an untouched WordPress timestamp is left as it is
    if (input.date !== dataText(stored, "date").slice(0, 10)) patch.setData("date", dataText(stored, "date"), input.date);
    // The plain text of an imported page. Text staff never changed compares equal to what the page
    // came with, so nothing is stored and the site keeps reading the imported markup (or its own words).
    const easyLayout = easyLayoutOf(before);
    if (easyLayout) {
      const easy = cleanEasy(easyLayout, input.easy);
      patch.setData("easy", cleanEasy(easyLayout, shown.easy) as unknown as Json, easy as unknown as Json);
    }
    patch.setData("footerTiles", readFooterTiles(stored.footerTiles) as unknown as Json, input.footerTiles as unknown as Json);
    // The address of an imported page is fixed: the site serves it from its own route folder.
    if (isCreatedPage(before) && input.path.trim() !== "" && input.path.trim() !== before.path) {
      const next = pagePath(input.path);
      if ("error" in next) return { success: false, error: next.error };
      if (next.path !== before.path) {
        const { data: clash, error: clashError } = await toursDb()
          .from("cms_pages")
          .select("id")
          .eq("company_id", company.id)
          .eq("path", next.path)
          .neq("id", id)
          .limit(1);
        if (clashError) throw clashError;
        if (clash && clash.length > 0) return { success: false, error: "Another page already has this address" };
        patch.set("path", before.path, next.path, "path");
        patch.data.slug = next.path.split("/").filter(Boolean).pop() ?? "";
      }
    }
    const seoTitle = input.seoTitle.trim();
    const seoDescription = input.seoDescription.trim();
    if (!same(shown.seoTitle, seoTitle) || !same(shown.seoDescription, seoDescription)) {
      const seo = { title: seoTitle, description: seoDescription };
      patch.set("seo", before.seo, { ...asObject(before.seo), ...seo });
      patch.data.seo = { ...asObject(asObject(before.data).seo), ...seo };
    }

    if (patch.dirty) {
      const { error } = await toursDb()
        .from("cms_pages")
        .update(patch.payload(before.data) as Tours["cms_pages"]["Update"])
        .eq("company_id", company.id)
        .eq("id", id);
      if (error) throw error;
      await logAudit({
        action: "update",
        entityType: "tours_cms_page",
        entityId: id,
        changes: patch.changes,
        metadata: { ...companyAudit(company), path: before.path },
      });
      revalidatePath("/tours/pages");
      revalidatePath(`/tours/pages/${id}`);
    }
    const fresh = await cmsPageRow(company, id);
    if (!fresh) return { success: false, error: "Page not found" };
    return { success: true, data: { ...cmsPageEditor(company, fresh, siteText), options: await siteEditorOptions(company) } };
  } catch (e) {
    return failure(e, "Failed to save the page");
  }
}
