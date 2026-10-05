/**
 * Shared vocabulary of the Mega Family content screens (trip pages, taxonomies,
 * instructors, hotels, content pages, leads, company settings).
 *
 * Plain module on purpose - no "use client" and no "use server" - so the server
 * actions and the client components import the same types and labels.
 */
import { matchesSearch } from "@/lib/search";
import type { HomeSection } from "@/lib/tours/site-content";
import type { SiteEditorOptions } from "@/lib/tours/site-options";

/** Every content / leads / settings action answers with this. Expected failures never throw. */
export type { ActionResult } from "@/lib/tours/action-kit";

// ---------------------------------------------------------------- trip pages
export const PACKAGE_KINDS = ["organized", "vacation", "village"] as const;
export type PackageKind = (typeof PACKAGE_KINDS)[number];
export const PACKAGE_KIND_LABELS: Record<PackageKind, string> = {
  organized: "Organized tour",
  vacation: "Vacation package",
  village: "Holiday village",
};
export const packageKindLabel = (kind: string): string => PACKAGE_KIND_LABELS[kind as PackageKind] ?? kind;

/** The card colour on the site ("brand world" inside the group). */
export const PACKAGE_BRANDS = ["family", "events", "organized", "general"] as const;
export type PackageBrand = (typeof PACKAGE_BRANDS)[number];
export const PACKAGE_BRAND_LABELS: Record<PackageBrand, string> = {
  family: "Families (red)",
  events: "Sports & music (teal)",
  organized: "Couples, women & solo travelers (purple)",
  general: "General (purple)",
};
export const PACKAGE_BRAND_COLORS: Record<PackageBrand, string> = {
  family: "#A61C14",
  events: "#1B6B70",
  organized: "#60356C",
  general: "#60356C",
};

export interface ItineraryDay {
  n: number;
  title: string;
  subtitle: string;
  html: string;
  image?: string;
}

export interface FaqItem {
  q: string;
  aHtml: string;
}

/** One picture of an instructor gallery, as the site stores it. */
export interface GalleryItem {
  src: string;
  title: string;
  caption: string;
}

export interface PackageListRow {
  id: string;
  slug: string;
  name: string;
  subtitle: string | null;
  kind: string;
  brand: string;
  cardImage: string | null;
  isActive: boolean;
  /** false = a stub the import created for a series that has no page content yet. */
  hasContent: boolean;
  seriesCodes: string[];
  /** Published departures that have not left yet - what the site lists on the page. */
  futurePublished: number;
}

export interface PackageList {
  rows: PackageListRow[];
  siteUrl: string | null;
}

export interface PackageForm {
  name: string;
  subtitle: string;
  slug: string;
  kind: string;
  brand: string;
  days: number | null;
  nights: number | null;
  countries: string;
  seasons: string[];
  isActive: boolean;
  heroImage: string;
  cardImage: string;
  gallery: string[];
  descriptionHtml: string;
  attractions: string[];
  included: string[];
  notIncluded: string[];
  extraInfoHtml: string;
  termsHtml: string;
  cancellationHtml: string;
  faq: FaqItem[];
  seoTitle: string;
  seoDescription: string;
  /** Terms attached to the page - every kind except the page's own "packages" term. */
  termIds: string[];
  /** The hotels of the tour, in the order the site shows them. */
  hotels: TourHotelStay[];
  /** The group leaders of the tour (tours.instructors ids), in the order the site lists them. */
  leaderIds: string[];
}

/** A blank organized tour page: Add Tour starts from it, and so does a tour a flight series creates. */
export const EMPTY_PACKAGE_FORM: PackageForm = {
  name: "",
  subtitle: "",
  slug: "",
  kind: "organized",
  brand: "family",
  days: null,
  nights: null,
  countries: "",
  seasons: [],
  isActive: false,
  heroImage: "",
  cardImage: "",
  gallery: [],
  descriptionHtml: "",
  attractions: [],
  included: [],
  notIncluded: [],
  extraInfoHtml: "",
  termsHtml: "",
  cancellationHtml: "",
  faq: [],
  seoTitle: "",
  seoDescription: "",
  termIds: [],
  hotels: [],
  leaderIds: [],
};

/** A page address from a name: spaces become hyphens, the characters an address cannot hold are dropped. */
export const slugFromName = (name: string): string =>
  name
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[/?#%"'`<>\\|^{}[\]]+/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");

/** A group leader a tour can list. */
export interface LeaderOption {
  id: string;
  name: string;
  image: string | null;
  isActive: boolean;
}

/**
 * A hotel of a tour as the site shows it (the site's HotelStay, lib/types.ts of
 * mega-family). A vacation package shows its first hotel in the booking funnel;
 * an organized tour lists them on its page. `code` points at the hotel catalog
 * row it was picked from - the site ignores it.
 */
export interface TourHotelStay {
  name: string;
  location: string;
  stars: number | null;
  nights: string;
  image: string;
  html: string;
  board?: string;
  dates?: string;
  distance?: string;
  amenities?: string[];
  roomFeatures?: string[];
  href?: string;
  code?: string;
}

/** A catalog hotel offered when a hotel is added to a tour. */
export interface TourHotelPick {
  id: string;
  code: string;
  name: string;
  city: string | null;
  stars: number | null;
  image: string | null;
  excerpt: string | null;
  contentHtml: string | null;
  amenities: string[];
}

/** A catalog hotel as a tour hotel: what "Add from catalog" puts in the list. */
export function hotelStayOf(hotel: TourHotelPick): TourHotelStay {
  return {
    name: hotel.name,
    location: hotel.city ?? "",
    stars: hotel.stars,
    nights: "",
    image: hotel.image ?? "",
    html: hotel.contentHtml || (hotel.excerpt ? `<p>${hotel.excerpt}</p>` : ""),
    amenities: hotel.amenities,
    code: hotel.code,
  };
}

// ---------------------------------------------------------------- new tour
/** The series a new tour sells on: its code is the prefix of every date code. */
export interface NewTourSeries {
  code: string;
  label: string;
  arrivalAirport: string;
  returnAirport: string;
  currency: string;
  capacity: number | null;
  childMaxAge: number;
}

/** Everything "Create Tour" saves in one go. */
export interface NewTourInput {
  /** The same form the tour page edits. */
  page: PackageForm;
  series: NewTourSeries;
  dates: { start: string; end: string }[];
  /** One price list for every new date (adult in a double room is the one the site needs). */
  prices: { paxType: string; position: number; price: number | null }[];
  /** The day-by-day plan (the main itinerary). */
  itinerary: ItineraryDay[];
  /** Flight blocks to link, by the start date of the new date they serve. */
  flights: { start: string; flightId: number; seats: number; legs: "both" | "outbound" | "inbound" }[];
}

export interface NewTourContext {
  siteUrl: string | null;
  terms: TermOption[];
  hotels: TourHotelPick[];
  leaders: LeaderOption[];
  /** Series codes in use - a new series needs a free one. */
  seriesCodes: string[];
  /** Slugs in use - the page address must be free. */
  slugs: string[];
}

/** Where Create Tour leaves the steps that failed, for the new tour's page to show once. */
export const createProblemsKey = (tourId: string) => `create-tour-problems:${tourId}`;

/** What reached the database. The tour exists once `id` is set, even when a later step failed. */
export interface NewTourResult {
  id: string;
  departures: number;
  flights: number;
  /** Steps that failed, in words - shown on the tour page so nothing is lost silently. */
  problems: string[];
}

// ---------------------------------------------------------------- ready for the site
export type ReadinessState = "done" | "todo" | "warn";

export interface TourReadinessItem {
  key: string;
  label: string;
  state: ReadinessState;
  detail: string;
  /** The tab of the tour page that fixes it. */
  tab?: string;
}

export interface TourReadiness {
  items: TourReadinessItem[];
  /** Every item but the warnings is done. */
  ready: boolean;
  /** The last change to the tour or its dates (ISO) - compared with the last site publish. */
  changedAt: string | null;
  lastPublish: SitePublishRecord | null;
}

export interface ItineraryVariant {
  /** null = the main variant of a page that has no itinerary row yet; saving creates it. */
  id: string | null;
  key: string;
  label: string;
  arrivalCity: string;
  returnCity: string;
  days: ItineraryDay[];
  /** Departures that point at this variant (a variant in use cannot be deleted). */
  departures: number;
}

export interface ItineraryInput {
  label: string;
  arrivalCity: string;
  returnCity: string;
  days: ItineraryDay[];
}

export interface ItineraryVariantInput {
  /** The variant to copy the days from. */
  sourceId: string;
  key: string;
  label: string;
  arrivalCity: string;
  returnCity: string;
}

export interface TermOption {
  id: string;
  kind: string;
  name: string;
  isActive: boolean;
  /** Set on an audience that is a world with a key: what a tour stores as its world. */
  world?: WorldOption;
}

/**
 * The worlds a tour can belong to: the four built-in ones (their site colors are
 * in the site's code) with the name and color staff gave them, then the worlds
 * added in Categories & Tags.
 */
export function worldOptions(terms: TermOption[]): WorldOption[] {
  const worlds = terms.flatMap((term) => (term.kind === "audiences" && term.world ? [term.world] : []));
  const builtIn = PACKAGE_BRANDS.map((brand) => {
    const world = worlds.find((w) => w.key === brand);
    return {
      key: brand as string,
      label: world ? `${world.label} - ${PACKAGE_BRAND_LABELS[brand]}` : PACKAGE_BRAND_LABELS[brand],
      color: world?.color || PACKAGE_BRAND_COLORS[brand],
    };
  });
  return [...builtIn, ...worlds.filter((w) => !(PACKAGE_BRANDS as readonly string[]).includes(w.key))];
}

// ---------------------------------------------------------------- seasons of a tour
/**
 * A season of a tour (tours.package_seasons): the dates assigned to it and what
 * it says instead of the tour page. An empty field means "the tour's own".
 */
export interface TourSeasonForm {
  name: string;
  /** The itinerary variant of the season's dates; "" = the main itinerary. */
  itineraryId: string;
  descriptionHtml: string;
  attractions: string[];
  included: string[];
  notIncluded: string[];
  heroImage: string;
  gallery: string[];
  /** Free tags, for landing pages built later ("חגים"). */
  tags: string[];
}

export interface TourSeasonRow extends TourSeasonForm {
  id: string;
  position: number;
}

export interface TourSeasonsData {
  seasons: TourSeasonRow[];
  /** tours.packages.seasons after the change - the tour form keeps it in step. */
  seasonNames: string[];
}

export const EMPTY_SEASON_FORM: TourSeasonForm = {
  name: "",
  itineraryId: "",
  descriptionHtml: "",
  attractions: [],
  included: [],
  notIncluded: [],
  heroImage: "",
  gallery: [],
  tags: [],
};

/** The seasons the site filters by (mega-family lib/site.ts SEASONS) - offered when a season is named. */
export const SEASON_NAME_SUGGESTIONS = ["קיץ", "חורף", "סתיו", "פסח", "שבועות", "חגי תשרי", "חנוכה", "סילבסטר"] as const;

export interface PackageEditorData {
  id: string;
  form: PackageForm;
  hasContent: boolean;
  /** The slug is the page address on the site - locked once departures sell on it. */
  slugLocked: boolean;
  departures: number;
  seriesCodes: string[];
  itineraries: ItineraryVariant[];
  terms: TermOption[];
  /** The company's hotel catalog - what the Hotels tab picks from. */
  hotelCatalog: TourHotelPick[];
  /** The company's group leaders - what the tour's leaders pick from. */
  leaderOptions: LeaderOption[];
  /** Last change of the tour row (ISO) - "published after the last change" compares with it. */
  updatedAt: string;
  siteUrl: string | null;
}

// ---------------------------------------------------------------- taxonomies
export const TERM_KINDS = ["destinations", "audiences", "tags", "packages", "artists", "villages", "categories"] as const;
export type TermKind = (typeof TERM_KINDS)[number];
export const TERM_KIND_LABELS: Record<TermKind, string> = {
  destinations: "Destinations",
  // An audience is a world of the group: Mega Family, Mega Events... (Alon's road map, 05.10.2026)
  audiences: "Worlds",
  tags: "Tags",
  packages: "Packages",
  artists: "Artists",
  villages: "Holiday villages",
  categories: "Categories",
};
export const termKindLabel = (kind: string): string => TERM_KIND_LABELS[kind as TermKind] ?? kind;

/**
 * The key of a trip page's `data` that lists the attached terms of a kind (by
 * the term's legacy id). The "packages" kind is the page's own term and is not
 * edited from the page.
 */
export const TERM_KIND_DATA_KEY: Partial<Record<TermKind, string>> = {
  destinations: "destinationIds",
  audiences: "audienceIds",
  tags: "tagIds",
  artists: "artistIds",
  villages: "villageIds",
  categories: "categoryIds",
};
/** The kinds a trip page can be attached to, in the order the editor shows them. */
export const PACKAGE_TERM_KINDS: TermKind[] = ["destinations", "audiences", "tags", "categories", "artists", "villages"];
/**
 * The kinds the Categories & Tags screen lists and adds. Packages (a tour's own
 * term, not a content page), artists (they come from Mega Events) and holiday
 * villages (a later phase) stay in the data and in the code, and are left out
 * of the screen for now (Alon's road map, 05.10.2026).
 */
export const LISTED_TERM_KINDS: TermKind[] = ["destinations", "audiences", "tags", "categories"];

/** A world of the group as a tour picks it: an audience staff gave a key (Categories & Tags > Worlds). */
export interface WorldOption {
  key: string;
  label: string;
  color: string;
}

export interface TermListRow {
  id: string;
  kind: string;
  slug: string;
  name: string;
  position: number;
  isActive: boolean;
  pages: number;
  heroImages: number;
}

export interface TermForm {
  name: string;
  descriptionHtml: string;
  heroImages: string[];
  position: number;
  isActive: boolean;
  /** The line under the title of the term's page on the site. */
  subtitle: string;
  /** The browser / search title of the term's page. */
  seoTitle: string;
  /** A world (an audience): its brand name ("מגה פמילי"), its color, a tile picture and a link when it lives on another site. */
  brandName: string;
  color: string;
  icon: string;
  externalUrl: string;
  /** A tag that is a sub-category of a world: that audience's slug ("" = none). */
  worldSlug: string;
  /** A world's own page sections (sliders, banners, text...), shown under its hero and sub-categories. */
  sections: HomeSection[];
}

export interface TermEditorData {
  id: string;
  kind: string;
  slug: string;
  form: TermForm;
  pages: { id: string; name: string }[];
  /** The company's worlds - what a tag picks its world from. */
  worlds: { slug: string; name: string }[];
  /** What the pickers of a world's page sections choose from (worlds only). */
  options: SiteEditorOptions | null;
  /** The address of the term's page on the site. */
  path: string;
  siteUrl: string | null;
}

// ---------------------------------------------------------------- instructors
export interface InstructorListRow {
  id: string;
  slug: string;
  name: string;
  image: string | null;
  regions: string | null;
  position: number;
  isActive: boolean;
}

export interface InstructorList {
  rows: InstructorListRow[];
  siteUrl: string | null;
}

export interface InstructorForm {
  name: string;
  image: string;
  regions: string;
  excerpt: string;
  contentHtml: string;
  gallery: GalleryItem[];
  position: number;
  isActive: boolean;
}

export interface InstructorEditorData {
  id: string;
  slug: string;
  form: InstructorForm;
  siteUrl: string | null;
}

// ---------------------------------------------------------------- hotels
export interface HotelListRow {
  id: string;
  code: string;
  name: string;
  city: string | null;
  stars: number | null;
  image: string | null;
  position: number;
}

export interface HotelList {
  rows: HotelListRow[];
  siteUrl: string | null;
}

export interface HotelForm {
  code: string;
  name: string;
  city: string;
  stars: number | null;
  image: string;
  gallery: string[];
  excerpt: string;
  contentHtml: string;
  amenities: string[];
}

export interface HotelEditorData {
  id: string;
  slug: string;
  form: HotelForm;
  /** Departure options that point at this hotel by its code - the code is locked while any exist. */
  optionsUsingCode: number;
  siteUrl: string | null;
}

// ---------------------------------------------------------------- content pages
/** cms_pages kinds this screen edits. "product" and "extras" are import payloads, not pages. */
export const CMS_PAGE_KINDS = ["page", "post"] as const;
export type CmsPageKind = (typeof CMS_PAGE_KINDS)[number];
export const CMS_PAGE_KIND_LABELS: Record<CmsPageKind, string> = { page: "Page", post: "Post" };
export const cmsPageKindLabel = (kind: string): string => CMS_PAGE_KIND_LABELS[kind as CmsPageKind] ?? kind;

export interface CmsPageListRow {
  id: string;
  kind: string;
  path: string;
  title: string;
  position: number;
  isActive: boolean;
  hasContent: boolean;
}

export interface CmsPageForm {
  title: string;
  /** The address on the site. Only a page made in the backoffice can change it. */
  path: string;
  contentHtml: string;
  /** A short opening line: shown above the text of a page made in the backoffice. */
  excerpt: string;
  /** The picture of the page's hero, and of a post's tile in the blog. */
  image: string;
  /** A post's date (yyyy-mm-dd): the blog lists the newest first. */
  date: string;
  seoTitle: string;
  seoDescription: string;
  isActive: boolean;
}

export interface CmsPageEditorData {
  id: string;
  kind: string;
  path: string;
  form: CmsPageForm;
  /** Made in the backoffice (not imported from WordPress): the site draws it with the general page template. */
  created: boolean;
  siteUrl: string | null;
}

/**
 * First segments a content page may not take: the site's own routes
 * (mega-family app/), so a new page can never shadow one of them.
 */
export const RESERVED_PAGE_ROOTS = [
  "about",
  "api",
  "artists",
  "audience",
  "booking",
  "cars",
  "destinations",
  "hotels",
  "instructors",
  "media",
  "package",
  "product",
  "product-category",
  "product-tag",
  "season",
  "villages",
  "_next",
];

// ---------------------------------------------------------------- leads
export const LEAD_STATUSES = ["new", "in_progress", "done", "spam"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  in_progress: "In progress",
  done: "Done",
  spam: "Spam",
};
export const leadStatusLabel = (status: string): string => LEAD_STATUS_LABELS[status as LeadStatus] ?? status;

/** What the inbox narrows its list by - the export reads the same rows. Empty = no filter. */
export interface LeadFilters {
  kind: string;
  status: string;
  /** The search box, matched by leadMatches. */
  q: string;
}

export interface LeadRow {
  id: string;
  createdAt: string;
  kind: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  message: string | null;
  sourcePath: string | null;
  status: string;
  assignedTo: string | null;
  payload: Record<string, unknown>;
  utm: Record<string, unknown>;
  /** The day staff plan to get back to the lead (yyyy-mm-dd), or null. */
  followUpDate: string | null;
  /** The staff's own notes on the lead - never shown to the customer. */
  notes: string | null;
}

/** A lead still being worked on whose follow-up day is today or already passed. */
export const leadFollowUpDue = (lead: LeadRow, today: string): boolean =>
  !!lead.followUpDate && lead.followUpDate <= today && (lead.status === "new" || lead.status === "in_progress");

/** A site path as people read it: Hebrew slugs decoded. */
export function readablePath(path: string | null): string {
  if (!path) return "";
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * Does a lead match the inbox search? The screen and the Excel export use this
 * one rule, so the file holds the rows the screen shows. The page is matched as
 * people read it (readablePath), so a Hebrew word finds a Hebrew slug.
 */
export const leadMatches = (lead: LeadRow, q: string): boolean =>
  matchesSearch(q, lead.name, lead.phone, lead.email, lead.message, readablePath(lead.sourcePath), lead.notes);

export interface LeadAssignee {
  id: string;
  name: string;
  email: string;
}

export interface LeadsPage {
  rows: LeadRow[];
  /** The company has more leads than one load reads; the oldest are left out. */
  truncated: boolean;
}

export interface LeadsMeta {
  assignees: LeadAssignee[];
  kinds: string[];
  currentUserId: string;
}

export interface LeadsExport {
  fileName: string;
  /** The .xlsx file, base64 encoded. */
  base64: string;
  rows: number;
}

// ---------------------------------------------------------------- company settings
export interface CompanySettingsForm {
  name: string;
  legalName: string;
  siteUrl: string;
  defaultCurrency: string;
  contact: { phone: string; whatsapp: string; email: string; address: string; hours: string };
  brand: { logo: string; primaryColor: string };
  email: { from: string; replyTo: string; leadsInbox: string };
  analytics: { gtm: string; pixel: string };
}

/** What to do with the deploy hook on save. The stored URL itself never reaches the browser. */
export type DeployHookChange = { action: "keep" } | { action: "clear" } | { action: "set"; url: string };

export interface SitePublishRecord {
  at: string;
  by: string;
  status: number | null;
  ok: boolean;
  error?: string;
}

export interface SitePublishStatus {
  /** Whether a deploy hook is stored for the company. The URL itself stays on the server. */
  configured: boolean;
  last: SitePublishRecord | null;
}

export interface CompanySettingsData {
  slug: string;
  form: CompanySettingsForm;
  deployHookSet: boolean;
  lastPublish: SitePublishRecord | null;
}

// ---------------------------------------------------------------- small helpers
// Dates and times: lib/tours/format.ts (fmtDate, fmtInstant).

/** Absolute address of a site asset: `/media/...` is served by the company's site. */
export function siteAssetUrl(siteUrl: string | null | undefined, path: string | null | undefined): string | null {
  const value = (path ?? "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (!siteUrl || !value.startsWith("/")) return null;
  return siteUrl.replace(/\/+$/, "") + value;
}

const SIMPLE_TAGS = new Set(["p", "br", "strong", "b", "em", "i", "ul", "ol", "li", "a", "h1", "h2", "h3", "blockquote"]);

/**
 * True when the HTML only uses what the visual editor can represent
 * (paragraphs, headings, lists, links, bold, italic) and carries no classes or
 * other attributes. Imported WordPress / Elementor markup is NOT simple: the
 * visual editor would silently strip the markup the site styling depends on,
 * so it is only offered for simple HTML.
 */
export function isSimpleHtml(html: string): boolean {
  if (html.includes("<!--")) return false;
  const tag = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(html))) {
    const name = match[1].toLowerCase();
    if (!SIMPLE_TAGS.has(name)) return false;
    const attrs = match[2].replace(/\/\s*$/, "").trim();
    if (!attrs) continue;
    if (name !== "a") return false;
    const rest = attrs.replace(/\b(href|target|rel)\s*=\s*("[^"]*"|'[^']*')/gi, "").trim();
    if (rest) return false;
  }
  return true;
}
