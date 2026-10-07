/**
 * The site chrome and the home page of a tours company, as documents
 * (tours.site_content, migration 20261005180000): what each document holds, what
 * a valid one looks like, and the section types of the home page.
 *
 * Pure - no server or browser imports - so the save action
 * (lib/actions/tours-site-actions.ts) and the editors (components/tours/site)
 * read the same rules. The customer site reads the same shapes
 * (mega-family lib/site.ts, lib/home.ts); it reads them defensively, so a field
 * added here is ignored there until the site learns it.
 */
import { z } from "zod";

export const SITE_DOC_KEYS = ["general", "header", "footer", "home"] as const;
export type SiteDocKey = (typeof SITE_DOC_KEYS)[number];

// ---------------------------------------------------------------- field rules
const HREF = /^(\/|#|https?:\/\/|tel:|mailto:)/i;
const HEX = /^#[0-9a-fA-F]{3,8}$/;
const RGBA = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/;

/** A color the site accepts: #hex or rgb()/rgba(). */
export const isSiteColor = (value: string): boolean => HEX.test(value) || RGBA.test(value);

const text = (max: number) => z.string().trim().max(max, `Up to ${max} characters`);
const label = (what: string, max = 160) => z.string().trim().min(1, `${what} needs a text`).max(max, `Up to ${max} characters`);
const href = z
  .string()
  .trim()
  .max(600)
  .refine((v) => v === "" || HREF.test(v), "A link starts with / (a page of the site), #, https://, tel: or mailto:");
/** A menu link: "#" (or empty) means the entry only opens its sub-menu. */
const menuHref = href.transform((v) => v || "#");
const image = z
  .string()
  .trim()
  .max(600)
  .refine((v) => v === "" || v.startsWith("/") || /^https:\/\//i.test(v), "An image is a path on the site (/media/...) or a full https:// address");
const color = z
  .string()
  .trim()
  .max(40)
  .refine((v) => v === "" || isSiteColor(v), "A color is #RRGGBB or rgba(r, g, b, a)");
const slug = text(200);

/**
 * Removes what must never reach the public site from staff-written HTML: script,
 * style and embedding tags, inline event handlers and javascript: addresses.
 * Formatting, links and images stay.
 */
export function stripActiveHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|form|link|meta|base)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed|form|link|meta|base)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]+)/gi, '$1="#"');
}

// ---------------------------------------------------------------- menus
const link3 = z.object({ label: label("A menu item"), href: menuHref });
const link2 = link3.extend({ children: z.array(link3).max(40).optional() });
const link1 = link2.extend({ children: z.array(link2).max(40).optional() });

export interface SiteLink {
  label: string;
  href: string;
  children?: SiteLink[];
}

export const headerSchema = z.object({
  menus: z
    .array(z.object({ label: label("A menu"), heading: text(160), items: z.array(link1).max(40) }))
    .max(8, "Up to 8 menus in the header"),
  links: z.array(link1).max(12),
  mobile: z.array(link1).max(40),
});
export type SiteHeader = z.infer<typeof headerSchema>;

const footerTile = z.object({ label: label("A tile"), href: menuHref, icon: image });
const footerColumns = z
  .array(z.object({ heading: text(160), links: z.array(z.object({ label: label("A footer link"), href: menuHref })).max(24) }))
  .max(10, "Up to 10 columns in the footer");

/** The kinds of page the tiles above the footer can be switched on or off for. */
export const FOOTER_TILE_PAGES = ["home", "pages", "terms", "tours"] as const;
export type FooterTilePage = (typeof FOOTER_TILE_PAGES)[number];
export const FOOTER_TILE_PAGE_LABELS: Record<FooterTilePage, string> = {
  home: "Home page",
  pages: "Content pages and the blog",
  terms: "World, category, tag and destination pages",
  tours: "Tour pages and the booking steps",
};
/** Where the tiles show until staff decide otherwise: everywhere but the tour pages. */
export const DEFAULT_DISCOVER_ON: Record<FooterTilePage, boolean> = { home: true, pages: true, terms: true, tours: false };

export const footerSchema = z.object({
  discoverTitle: text(160),
  discover: z.array(footerTile).max(8),
  discoverOn: z.object({ home: z.boolean(), pages: z.boolean(), terms: z.boolean(), tours: z.boolean() }).default(DEFAULT_DISCOVER_ON),
  newsletterTitle: text(240),
  newsletterNote: text(240),
  contactTitle: text(160),
  columns: footerColumns,
  /** The footer of a phone: its own columns (empty = the same columns as the desktop), opened by a tap or all open. */
  mobileColumns: footerColumns.default([]),
  mobileAccordion: z.boolean().default(false),
});
export type SiteFooter = z.infer<typeof footerSchema>;

/**
 * What one page does with the tiles above the footer: follow the rule of its
 * kind of page (Header & Footer > Footer), always show the main tiles, hide
 * them, or show tiles of its own.
 */
export const FOOTER_TILE_MODES = ["default", "show", "hide", "custom"] as const;
export type FooterTileMode = (typeof FOOTER_TILE_MODES)[number];
export const FOOTER_TILE_MODE_LABELS: Record<FooterTileMode, string> = {
  default: "As set in Header & Footer",
  show: "Always show the main tiles",
  hide: "Hide on this page",
  custom: "This page's own tiles",
};
export const footerTilesSchema = z.object({
  mode: z.enum(FOOTER_TILE_MODES),
  title: text(160),
  items: z.array(footerTile).max(8),
});
export type FooterTiles = z.infer<typeof footerTilesSchema>;
export const DEFAULT_FOOTER_TILES: FooterTiles = { mode: "default", title: "", items: [] };

/** A page's stored choice as the editor works on it; anything unreadable follows the rule of its kind of page. */
export function readFooterTiles(stored: unknown): FooterTiles {
  const parsed = footerTilesSchema.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_FOOTER_TILES;
}

export const generalSchema = z.object({
  name: label("The site name", 120),
  tagline: text(240),
  description: text(400),
  logo: image,
  phone: text(40),
  fax: text(40),
  whatsapp: text(40),
  email: z.string().trim().max(200).refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address"),
  address: text(240),
  addressShort: z.array(text(120)).max(2),
  facebook: href,
  instagram: href,
  youtube: href,
  companyLegal: text(240),
  hours: z.array(text(120)).max(6),
  copyright: text(240),
  poweredBy: z.object({ label: text(120), href }),
  leadTitle: text(300),
  leadOptions: z.array(text(120)).max(12),
  /** The company's business profile on Google; its reviews are mirrored daily (lib/services/google-reviews-sync.ts). */
  googlePlaceId: z
    .string()
    .trim()
    .max(80)
    .refine((v) => v === "" || /^[A-Za-z0-9_-]{16,80}$/.test(v), "A Google Place ID is letters, digits, - and _ (it usually starts with ChIJ)")
    .default(""),
});
export type SiteGeneral = z.infer<typeof generalSchema>;

// ---------------------------------------------------------------- home page
const base = { id: z.string().trim().min(1).max(60), visible: z.boolean() };

export const TOUR_SOURCES = ["world", "tag", "destination", "category", "sale", "all", "manual"] as const;
export type TourSource = (typeof TOUR_SOURCES)[number];
export const TOUR_SOURCE_LABELS: Record<TourSource, string> = {
  world: "The tours of a world",
  tag: "The tours of a tag",
  destination: "The tours of a destination",
  category: "The tours of a category",
  sale: "Tours on sale",
  all: "All tours",
  manual: "Tours I pick",
};
/** The term kind a slider's rule reads, when the rule is a term. */
export const TOUR_SOURCE_KIND: Partial<Record<TourSource, "audiences" | "tags" | "destinations" | "categories">> = {
  world: "audiences",
  tag: "tags",
  destination: "destinations",
  category: "categories",
};

const heroSlides = z
  .array(z.object({ image: image.refine((v) => v !== "", "A banner needs an image"), alt: text(200), href }))
  .max(10, "Up to 10 banners");

const heroSection = z.object({
  ...base,
  type: z.literal("hero"),
  titleBold: text(120),
  titleRest: text(200),
  text: text(400),
  slides: heroSlides,
});

/** What a category tile lists: the same rules as an automatic slider. */
export const TAB_SHOWS = ["sale", "all", "world", "tag", "destination", "category", "manual"] as const;
export type TabShow = (typeof TAB_SHOWS)[number];
/** The term kind a tile's rule reads, when the rule is a term other than a world (a world keeps its own field). */
export const TAB_TERM_KIND: Partial<Record<TabShow, "tags" | "destinations" | "categories">> = {
  tag: "tags",
  destination: "destinations",
  category: "categories",
};

/** A row of tours that belongs to one category tile: shown under the search until the customer searches. */
const tabRow = z.object({
  id: z.string().trim().min(1).max(60),
  title: text(160),
  source: z.enum(TOUR_SOURCES),
  term: slug,
  tours: z.array(slug).max(24),
  limit: z.number().int().min(1).max(24),
});
export type TabRow = z.infer<typeof tabRow>;

const EMPTY_TAB_BANNER = { titleBold: "", titleRest: "", text: "", slides: [] };

const toursTab = z
  .object({
    key: z.string().trim().min(1).max(40),
    label: label("A category tile", 60),
    icon: image,
    show: z.enum(TAB_SHOWS),
    world: slug,
    term: slug.default(""),
    tours: z.array(slug).max(48).default([]),
    allLabel: text(60),
    color,
    search: z.enum(["filters", "text"]),
    /** The trip-type pills of the tile, as tag slugs in order; empty = built from the tags of its tours. */
    pillTags: z.array(slug).max(24).default([]),
    /** The top banner while this tile is chosen; no banners = the page's general hero. */
    banner: z.object({ titleBold: text(120), titleRest: text(200), text: text(400), slides: heroSlides }).default(EMPTY_TAB_BANNER),
    rows: z.array(tabRow).max(6, "Up to 6 rows on a category tile").default([]),
    // The single "featured row" of the first version of this document; read into `rows` below.
    featuredTitle: text(120).default(""),
    featured: z.array(slug).max(12).default([]),
  })
  .transform(({ featuredTitle, featured, ...tab }) => ({
    ...tab,
    rows:
      tab.rows.length > 0 || !featuredTitle || featured.length === 0
        ? tab.rows
        : [{ id: `row_${tab.key}`, title: featuredTitle, source: "manual" as const, term: "", tours: featured, limit: 12 }],
  }));

const toursSection = z.object({
  ...base,
  type: z.literal("tours"),
  gridTitle: text(120),
  tabs: z.array(toursTab).max(8, "Up to 8 category tiles"),
  salePills: z.array(z.object({ label: label("A trip type", 60), tag: slug })).max(16),
});

const leadSection = z.object({ ...base, type: z.literal("lead_form"), title: text(300) });

const termItems = z.array(z.object({ slug: slug.refine((v) => v !== "", "Choose an item"), image })).max(24);
/** How a tile or banner section is filled: items staff pick, or by itself from the tours of a rule. */
export const FILL_MODES = ["manual", "auto"] as const;
/** The rules an automatic tile section can follow: the destinations (or artists) of these tours. */
export const TILE_SOURCES = ["all", "world", "tag", "category", "sale"] as const;
export type TileSource = (typeof TILE_SOURCES)[number];
export const TILE_SOURCE_LABELS: Record<TileSource, string> = {
  all: "All of them",
  world: "Of the tours of a world",
  tag: "Of the tours of a tag",
  category: "Of the tours of a category",
  sale: "Of the tours on sale",
};
const tileFill = {
  mode: z.enum(FILL_MODES).default("manual"),
  source: z.enum(TILE_SOURCES).default("all"),
  term: slug.default(""),
  limit: z.number().int().min(1).max(24).default(6),
};
const artistsSection = z.object({ ...base, type: z.literal("artists"), title: text(160), items: termItems, ...tileFill });
const destinationsSection = z.object({ ...base, type: z.literal("destinations"), title: text(160), items: termItems, ...tileFill });

const bannersSection = z.object({
  ...base,
  type: z.literal("banners"),
  title: text(160),
  /** Automatic: one banner per tour of the rule (the tour's picture and name, a button to its page). */
  mode: z.enum(FILL_MODES).default("manual"),
  source: z.enum(TOUR_SOURCES).default("sale"),
  term: slug.default(""),
  tours: z.array(slug).max(24).default([]),
  limit: z.number().int().min(1).max(12).default(4),
  autoCta: text(80).default(""),
  items: z
    .array(
      z.object({
        title: text(120),
        subtitle: text(200),
        cta: text(80),
        href,
        newTab: z.boolean(),
        image,
        overlayColor: color,
        buttonColor: color,
      }),
    )
    .max(8, "Up to 8 banners"),
});

const reasonsSection = z.object({
  ...base,
  type: z.literal("reasons"),
  title: text(160),
  items: z.array(z.object({ icon: image, title: text(120), text: text(400) })).max(8),
});

/** How many reviews one section holds, and how long one may be. */
export const REVIEWS_MAX = 24;
export const REVIEW_TEXT_MAX = 3000;

const reviewsSection = z.object({
  ...base,
  type: z.literal("reviews"),
  title: text(160),
  /** Typed here, or the company's Google reviews (mirrored daily): the newest ones with at least `minRating` stars. */
  source: z.enum(["manual", "google"]).default("manual"),
  minRating: z.number().int().min(1).max(5).default(4),
  limit: z.number().int().min(1).max(24).default(8),
  items: z
    .array(
      z.object({
        name: text(120),
        text: z.string().trim().min(1, "A review needs a text").max(REVIEW_TEXT_MAX),
        /** Stars the site draws above the text; 0 = none. */
        rating: z.number().int().min(0).max(5).default(0),
        /** Where a picked review came from ("form:<answer id>"), so the picker can mark it as already taken; "" = typed here. */
        ref: text(80).default(""),
      }),
    )
    .max(REVIEWS_MAX),
});

const sliderSection = z.object({
  ...base,
  type: z.literal("slider"),
  title: text(160),
  source: z.enum(TOUR_SOURCES),
  term: slug,
  tours: z.array(slug).max(24),
  limit: z.number().int().min(1).max(24),
  moreLabel: text(80),
  moreHref: href,
});

const worldsSection = z.object({ ...base, type: z.literal("worlds"), title: text(160) });

const textSection = z.object({
  ...base,
  type: z.literal("text"),
  title: text(160),
  html: z.string().max(20000, "The text is too long").transform(stripActiveHtml),
});

const imageSection = z.object({
  ...base,
  type: z.literal("image"),
  image: image.refine((v) => v !== "", "Choose an image"),
  alt: text(200),
  href,
  newTab: z.boolean(),
});

// The parts every term page (a world, a tag, a category, a destination) is built with. They are
// always in the page's list - staff move or hide them, never remove them.
const subcategoriesBlock = z.object({ ...base, type: z.literal("subcategories") });
const termToursBlock = z.object({ ...base, type: z.literal("term_tours") });
const termDescriptionBlock = z.object({ ...base, type: z.literal("term_description") });

export const homeSectionSchema = z.discriminatedUnion("type", [
  heroSection,
  toursSection,
  leadSection,
  artistsSection,
  destinationsSection,
  bannersSection,
  reasonsSection,
  reviewsSection,
  sliderSection,
  worldsSection,
  textSection,
  imageSection,
  subcategoriesBlock,
  termToursBlock,
  termDescriptionBlock,
]);
export type HomeSection = z.infer<typeof homeSectionSchema>;
export type HomeSectionType = HomeSection["type"];

/** The built-in parts of a term page. */
export const TERM_BLOCK_TYPES: HomeSectionType[] = ["subcategories", "term_tours", "term_description"];

const needsTerm = (source: string, term: string): boolean => Boolean(TOUR_SOURCE_KIND[source as TourSource]) && !term;

/**
 * What is still missing in one section before it can be saved, in plain words
 * (a rule that names no world, tag, destination or category); null = nothing.
 * The schemas and the editors' save bars read the same answer.
 */
export function sectionProblem(section: HomeSection): string | null {
  const named = (what: string, title: string) => `${what} "${title || "(no title)"}"`;
  switch (section.type) {
    case "slider":
      return needsTerm(section.source, section.term) ? `choose the ${section.source} of the slider ${named("", section.title).trim()}` : null;
    case "banners":
      return section.mode === "auto" && needsTerm(section.source, section.term) ? `choose the ${section.source} the banners come from` : null;
    case "artists":
    case "destinations":
      return section.mode === "auto" && needsTerm(section.source, section.term) ? `choose the ${section.source} the tiles come from` : null;
    case "tours":
      for (const tab of section.tabs) {
        const tile = named("the tile", tab.label);
        if (tab.show === "world" && !tab.world) return `choose the world of ${tile}`;
        if (TAB_TERM_KIND[tab.show] && !tab.term) return `choose the ${tab.show} of ${tile}`;
        for (const row of tab.rows) if (needsTerm(row.source, row.term)) return `choose the ${row.source} of the row ${named("", row.title).trim()} in ${tile}`;
      }
      return null;
    default:
      return null;
  }
}

function refineSections(sections: HomeSection[], ctx: z.RefinementCtx, path: (string | number)[]): void {
  const seen = new Set<string>();
  sections.forEach((section, index) => {
    if (seen.has(section.id)) ctx.addIssue({ code: "custom", message: "Two sections share an id", path: [...path, index, "id"] });
    seen.add(section.id);
    const problem = sectionProblem(section);
    if (problem) ctx.addIssue({ code: "custom", message: problem.replace(/^./, (c) => c.toUpperCase()), path: [...path, index] });
  });
}

export const homeSchema = z
  .object({
    sections: z.array(homeSectionSchema).max(30, "Up to 30 sections on the home page"),
    footerTiles: footerTilesSchema.default(DEFAULT_FOOTER_TILES),
  })
  .superRefine((doc, ctx) => {
    refineSections(doc.sections, ctx, ["sections"]);
    doc.sections.forEach((section, index) => {
      if (TERM_BLOCK_TYPES.includes(section.type)) ctx.addIssue({ code: "custom", message: "This part belongs to a category page, not to the home page", path: ["sections", index, "type"] });
    });
  });
export type HomeDoc = z.infer<typeof homeSchema>;

// ---------------------------------------------------------------- term pages
/** The term kinds whose page staff build like the home page. */
export const TERM_PAGE_KINDS = ["destinations", "audiences", "tags", "categories"] as const;
export type TermPageKind = (typeof TERM_PAGE_KINDS)[number];
export const isTermPageKind = (kind: string): kind is TermPageKind => (TERM_PAGE_KINDS as readonly string[]).includes(kind);

/**
 * The section types staff can add to a term page. The page's picture and title
 * stay on top; the hero banners and the tour finder belong to the home page.
 */
export const TERM_SECTION_TYPES: HomeSectionType[] = ["slider", "banners", "image", "text", "reasons", "destinations", "artists", "worlds", "lead_form", "reviews"];

const block = (type: "subcategories" | "term_tours" | "term_description", visible = true): HomeSection => ({ id: `b_${type}`, visible, type });
const LEAD_BLOCK: HomeSection = { id: "b_lead_form", visible: true, type: "lead_form", title: "" };
const REVIEWS_BLOCK: HomeSection = { id: "b_reviews", visible: true, type: "reviews", title: "", source: "manual", minRating: 4, limit: 8, items: [] };

/**
 * A term page as it is before staff arrange it: the built-in parts in the order
 * the site has always drawn them, with the sections staff already added
 * (`added`) where the site drew those. The customer site holds the same order
 * (mega-family lib/home.ts termLayout) - change both together.
 */
export function defaultTermLayout(kind: TermPageKind, added: HomeSection[] = []): HomeSection[] {
  switch (kind) {
    case "audiences":
      return [block("subcategories"), ...added, block("term_tours"), block("term_description"), LEAD_BLOCK, REVIEWS_BLOCK];
    case "tags":
      return [...added, block("term_tours"), block("term_description"), LEAD_BLOCK, REVIEWS_BLOCK];
    case "destinations":
      return [block("term_description"), ...added, block("term_tours"), LEAD_BLOCK];
    case "categories":
      // a category page never showed its description: the part is there, switched off
      return [...added, block("term_tours"), block("term_description", false), LEAD_BLOCK];
  }
}

const allowedOnTerm = (kind: TermPageKind, type: HomeSectionType): boolean =>
  TERM_SECTION_TYPES.includes(type) || type === "term_tours" || type === "term_description" || (type === "subcategories" && kind === "audiences");

/** The page of one term (tours.terms.data.sections): the built-in parts and the sections staff added, in order. */
export const termSectionsSchema = (kind: TermPageKind) =>
  z
    .array(homeSectionSchema)
    .max(20, "Up to 20 parts on a page")
    .superRefine((sections, ctx) => {
      refineSections(sections, ctx, []);
      sections.forEach((section, index) => {
        if (!allowedOnTerm(kind, section.type)) ctx.addIssue({ code: "custom", message: "This section type is not for this page", path: [index, "type"] });
      });
      for (const type of ["term_tours", "term_description", "subcategories", "lead_form", "reviews", "worlds"] as const) {
        if (sections.filter((s) => s.type === type).length > 1) ctx.addIssue({ code: "custom", message: `The page holds "${sectionKind(type)?.label ?? type}" twice`, path: [] });
      }
      if (!sections.some((s) => s.type === "term_tours")) ctx.addIssue({ code: "custom", message: "The tour list is missing from the page (hide it instead of removing it)", path: [] });
    });

/**
 * A term's stored page as the editor works on it. A page staff never arranged
 * (no tour list in the stored list) opens as the default layout around whatever
 * sections it already had.
 */
export function readTermSections(kind: TermPageKind, stored: unknown): HomeSection[] {
  const valid = (Array.isArray(stored) ? stored : []).flatMap((section) => {
    const one = homeSectionSchema.safeParse(section);
    return one.success && allowedOnTerm(kind, one.data.type) ? [one.data] : [];
  });
  if (!valid.some((s) => s.type === "term_tours")) return defaultTermLayout(kind, valid.filter((s) => !TERM_BLOCK_TYPES.includes(s.type)));
  const layout = [...valid];
  // a built-in part that an older save did not know is put back, hidden where it was never shown
  for (const part of defaultTermLayout(kind)) {
    if (TERM_BLOCK_TYPES.includes(part.type) && !layout.some((s) => s.type === part.type)) layout.push(part);
  }
  return layout;
}

export interface SiteDocs {
  general: SiteGeneral;
  header: SiteHeader;
  footer: SiteFooter;
  home: HomeDoc;
}

export const SITE_DOC_SCHEMAS = { general: generalSchema, header: headerSchema, footer: footerSchema, home: homeSchema } as const;

/** What a company starts from when it has no document yet. */
export const EMPTY_SITE_DOCS: SiteDocs = {
  general: {
    name: "",
    tagline: "",
    description: "",
    logo: "",
    phone: "",
    fax: "",
    whatsapp: "",
    email: "",
    address: "",
    addressShort: [],
    facebook: "",
    instagram: "",
    youtube: "",
    companyLegal: "",
    hours: [],
    copyright: "",
    poweredBy: { label: "", href: "" },
    leadTitle: "",
    leadOptions: [],
    googlePlaceId: "",
  },
  header: { menus: [], links: [], mobile: [] },
  footer: {
    discoverTitle: "",
    discover: [],
    discoverOn: DEFAULT_DISCOVER_ON,
    newsletterTitle: "",
    newsletterNote: "",
    contactTitle: "",
    columns: [],
    mobileColumns: [],
    mobileAccordion: false,
  },
  home: { sections: [], footerTiles: DEFAULT_FOOTER_TILES },
};

// ---------------------------------------------------------------- section catalog
export interface SectionKind {
  type: HomeSectionType;
  label: string;
  /** One line under the name in "Add Section" and on the section's card. */
  description: string;
  /** Only one of these makes sense on a page (the lead form, the tour tabs). */
  single?: boolean;
  /** A built-in part of a term page: always in the list, moved or hidden but never added or removed. */
  builtIn?: boolean;
}

export const SECTION_KINDS: SectionKind[] = [
  { type: "subcategories", label: "Sub-categories", description: "The tags attached to this world, as buttons in the world's color. Nothing shows while the world has none.", builtIn: true },
  { type: "term_tours", label: "Tour list", description: "Every tour of this page, with its search. The page fills it by itself.", builtIn: true },
  { type: "term_description", label: "Description", description: "The description written further down this screen.", builtIn: true },
  { type: "hero", label: "Hero banners", description: "The big rotating banners at the top, with the title card. A category tile can swap them for banners of its own.", single: true },
  { type: "tours", label: "Tour finder", description: "The category tiles, each with its banner, its tours and its rows, then the trip-type pills, the search and the tour grid.", single: true },
  { type: "slider", label: "Automatic tour slider", description: "A row of tours that fills itself: by world, tag, destination, category, sale, or tours you pick." },
  { type: "worlds", label: "Worlds", description: "One tile per world of the group, in its own color.", single: true },
  { type: "banners", label: "Banners", description: "Picture cards with a title, a line and a button." },
  { type: "image", label: "Wide image", description: "One picture across the page, with an optional link." },
  { type: "destinations", label: "Destination tiles", description: "Picture tiles of destinations, with the number of tours in each." },
  { type: "artists", label: "Artist tiles", description: "A slider of artists." },
  { type: "reasons", label: "Reasons", description: "Icons with a title and a line: why travel with us." },
  { type: "reviews", label: "Reviews", description: "What customers say. The category pages show the same reviews.", single: true },
  { type: "text", label: "Text", description: "A title and formatted text." },
  { type: "lead_form", label: "Lead form", description: "The \"did not find what you were looking for\" form.", single: true },
];

export const sectionKind = (type: string): SectionKind | undefined => SECTION_KINDS.find((kind) => kind.type === type);

/** A short random id for a new section or tab. */
export const newId = (prefix: string): string => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

/** A new section of a type, with nothing in it yet. */
export function newSection(type: HomeSectionType): HomeSection {
  const common = { id: newId(type), visible: true };
  switch (type) {
    case "hero":
      return { ...common, type, titleBold: "", titleRest: "", text: "", slides: [] };
    case "tours":
      return { ...common, type, gridTitle: "", tabs: [], salePills: [] };
    case "lead_form":
      return { ...common, type, title: "" };
    case "artists":
    case "destinations":
      return { ...common, type, title: "", items: [], mode: "manual", source: "all", term: "", limit: 6 };
    case "banners":
      return { ...common, type, title: "", items: [], mode: "manual", source: "sale", term: "", tours: [], limit: 4, autoCta: "" };
    case "reasons":
      return { ...common, type, title: "", items: [] };
    case "reviews":
      return { ...common, type, title: "", items: [], source: "manual", minRating: 4, limit: 8 };
    case "subcategories":
    case "term_tours":
    case "term_description":
      return { ...common, type };
    case "slider":
      return { ...common, type, title: "", source: "all", term: "", tours: [], limit: 8, moreLabel: "", moreHref: "" };
    case "worlds":
      return { ...common, type, title: "" };
    case "text":
      return { ...common, type, title: "", html: "" };
    case "image":
      return { ...common, type, image: "", alt: "", href: "", newTab: false };
  }
}

/** The line a section's card shows while it is folded: its title, or what it holds. */
export function sectionSummary(section: HomeSection): string {
  switch (section.type) {
    case "hero":
      return [`${section.slides.length} banners`, [section.titleBold, section.titleRest].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
    case "tours":
      return `${section.tabs.length} category tiles`;
    case "lead_form":
      return section.title || "The site's lead form title";
    case "artists":
    case "destinations":
      return [section.title, section.mode === "auto" ? `Automatic · ${TILE_SOURCE_LABELS[section.source]}` : `${section.items.length} items`].filter(Boolean).join(" · ");
    case "banners":
      return [section.title, section.mode === "auto" ? `Automatic · ${TOUR_SOURCE_LABELS[section.source]}` : `${section.items.length} items`].filter(Boolean).join(" · ");
    case "reviews":
      return [section.title, section.source === "google" ? "From Google" : `${section.items.length} items`].filter(Boolean).join(" · ");
    case "reasons":
      return [section.title, `${section.items.length} items`].filter(Boolean).join(" · ");
    case "subcategories":
      return "The tags attached to this world";
    case "term_tours":
      return "Every tour of this page, with its search";
    case "term_description":
      return "The description written below";
    case "slider":
      return [section.title, TOUR_SOURCE_LABELS[section.source], section.term].filter(Boolean).join(" · ");
    case "worlds":
      return section.title || "Every world with a brand name";
    case "text":
      return section.title || "Text";
    case "image":
      return section.alt || section.image || "No image yet";
  }
}

/**
 * Reads a stored document into the shape the editor works on: a valid stored
 * document comes back as is; a missing or older one is completed with empty
 * values, so the editor never meets an undefined list.
 */
export function readSiteDoc<K extends SiteDocKey>(key: K, stored: unknown): SiteDocs[K] {
  const parsed = SITE_DOC_SCHEMAS[key].safeParse(stored);
  if (parsed.success) return parsed.data as SiteDocs[K];
  const empty = EMPTY_SITE_DOCS[key] as Record<string, unknown>;
  const loose = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  // keep what is there, field by field; a field of the wrong type falls back to its empty value
  const merged: Record<string, unknown> = { ...empty };
  for (const [field, fallback] of Object.entries(empty)) {
    const value = loose[field];
    if (value === undefined || value === null) continue;
    if (Array.isArray(fallback) ? Array.isArray(value) : typeof value === typeof fallback) merged[field] = value;
  }
  // The home page keeps every section that is valid on its own: one broken section never hides the rest.
  if (key === "home") {
    const sections = Array.isArray(merged.sections) ? merged.sections : [];
    merged.sections = sections.flatMap((section) => {
      const one = homeSectionSchema.safeParse(section);
      return one.success ? [one.data] : [];
    });
    merged.footerTiles = readFooterTiles(merged.footerTiles);
    return merged as unknown as SiteDocs[K];
  }
  // The other documents are flat forms: a document that does not parse opens empty rather than half-read.
  const second = SITE_DOC_SCHEMAS[key].safeParse(merged);
  return (second.success ? second.data : EMPTY_SITE_DOCS[key]) as SiteDocs[K];
}
