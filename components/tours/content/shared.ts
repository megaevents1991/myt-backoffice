/**
 * Shared vocabulary of the Mega Family content screens (trip pages, taxonomies,
 * instructors, hotels, content pages, leads, company settings).
 *
 * Plain module on purpose - no "use client" and no "use server" - so the server
 * actions and the client components import the same types and labels.
 */

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
}

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
  siteUrl: string | null;
}

// ---------------------------------------------------------------- taxonomies
export const TERM_KINDS = ["destinations", "audiences", "tags", "packages", "artists", "villages", "categories"] as const;
export type TermKind = (typeof TERM_KINDS)[number];
export const TERM_KIND_LABELS: Record<TermKind, string> = {
  destinations: "Destinations",
  audiences: "Audiences",
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
}

export interface TermEditorData {
  id: string;
  kind: string;
  slug: string;
  form: TermForm;
  pages: { id: string; name: string }[];
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
  contentHtml: string;
  seoTitle: string;
  seoDescription: string;
  isActive: boolean;
}

export interface CmsPageEditorData {
  id: string;
  kind: string;
  path: string;
  form: CmsPageForm;
  siteUrl: string | null;
}

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

export interface LeadFilters {
  kind: string;
  status: string;
  /** yyyy-mm-dd, inclusive. Empty = no bound. */
  from: string;
  to: string;
  q: string;
}
export const EMPTY_LEAD_FILTERS: LeadFilters = { kind: "", status: "", from: "", to: "", q: "" };

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
}

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

export interface CompanyMemberRow {
  userId: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
}

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
  members: CompanyMemberRow[];
}

/**
 * Names of the member roles that ROLE_LABELS (types/auth.types.ts) does not
 * label yet. ROLE_LABELS is read first, so a role it names is named there only.
 */
export const COMPANY_ROLE_LABELS: Record<string, string> = {
  superadmin: "Superadmin",
  admin: "Admin",
  editor: "Editor",
  office_manager: "Office manager",
  agent: "Agent",
  affiliate: "Affiliate",
  forms_operator: "Forms operator",
};

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
