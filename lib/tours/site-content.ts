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

export const footerSchema = z.object({
  discoverTitle: text(160),
  discover: z.array(z.object({ label: label("A tile"), href: menuHref, icon: image })).max(8),
  newsletterTitle: text(240),
  newsletterNote: text(240),
  contactTitle: text(160),
  columns: z
    .array(z.object({ heading: text(160), links: z.array(z.object({ label: label("A footer link"), href: menuHref })).max(24) }))
    .max(10, "Up to 10 columns in the footer"),
});
export type SiteFooter = z.infer<typeof footerSchema>;

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

const heroSection = z.object({
  ...base,
  type: z.literal("hero"),
  titleBold: text(120),
  titleRest: text(200),
  text: text(400),
  slides: z.array(z.object({ image: image.refine((v) => v !== "", "A banner needs an image"), alt: text(200), href })).max(10, "Up to 10 banners"),
});

const toursTab = z.object({
  key: z.string().trim().min(1).max(40),
  label: label("A category tile", 60),
  icon: image,
  show: z.enum(["sale", "all", "world"]),
  world: slug,
  allLabel: text(60),
  color,
  search: z.enum(["filters", "text"]),
  featuredTitle: text(120),
  featured: z.array(slug).max(12),
});

const toursSection = z.object({
  ...base,
  type: z.literal("tours"),
  gridTitle: text(120),
  tabs: z.array(toursTab).max(8, "Up to 8 category tiles"),
  salePills: z.array(z.object({ label: label("A trip type", 60), tag: slug })).max(16),
});

const leadSection = z.object({ ...base, type: z.literal("lead_form"), title: text(300) });

const termItems = z.array(z.object({ slug: slug.refine((v) => v !== "", "Choose an item"), image })).max(24);
const artistsSection = z.object({ ...base, type: z.literal("artists"), title: text(160), items: termItems });
const destinationsSection = z.object({ ...base, type: z.literal("destinations"), title: text(160), items: termItems });

const bannersSection = z.object({
  ...base,
  type: z.literal("banners"),
  title: text(160),
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

const reviewsSection = z.object({
  ...base,
  type: z.literal("reviews"),
  title: text(160),
  items: z.array(z.object({ name: text(120), text: z.string().trim().min(1, "A review needs a text").max(3000) })).max(24),
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
]);
export type HomeSection = z.infer<typeof homeSectionSchema>;
export type HomeSectionType = HomeSection["type"];

export const homeSchema = z
  .object({ sections: z.array(homeSectionSchema).max(30, "Up to 30 sections on the home page") })
  .superRefine((doc, ctx) => {
    const seen = new Set<string>();
    doc.sections.forEach((section, index) => {
      if (seen.has(section.id)) ctx.addIssue({ code: "custom", message: "Two sections share an id", path: ["sections", index, "id"] });
      seen.add(section.id);
      if (section.type === "slider" && TOUR_SOURCE_KIND[section.source] && !section.term) {
        ctx.addIssue({ code: "custom", message: `The slider "${section.title || "(no title)"}" needs its ${section.source}`, path: ["sections", index, "term"] });
      }
    });
  });
export type HomeDoc = z.infer<typeof homeSchema>;

/**
 * The section types a world's own page can carry, under its hero and its
 * sub-categories. The hero, the tour finder, the reviews and the lead form are
 * already part of every world page, so they are not offered there.
 */
export const WORLD_SECTION_TYPES: HomeSectionType[] = ["slider", "banners", "image", "text", "reasons", "destinations", "artists"];

/** The sections of one world's page (tours.terms.data.sections). */
export const worldSectionsSchema = z
  .array(homeSectionSchema)
  .max(12, "Up to 12 sections on a world page")
  .superRefine((sections, ctx) => {
    const seen = new Set<string>();
    sections.forEach((section, index) => {
      if (!WORLD_SECTION_TYPES.includes(section.type)) ctx.addIssue({ code: "custom", message: "This section type is not for a world page", path: [index, "type"] });
      if (seen.has(section.id)) ctx.addIssue({ code: "custom", message: "Two sections share an id", path: [index, "id"] });
      seen.add(section.id);
      if (section.type === "slider" && TOUR_SOURCE_KIND[section.source] && !section.term) {
        ctx.addIssue({ code: "custom", message: `The slider "${section.title || "(no title)"}" needs its ${section.source}`, path: [index, "term"] });
      }
    });
  });

/** Stored world sections as the editor works on them: the valid ones, in order. */
export function readWorldSections(stored: unknown): HomeSection[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((section) => {
    const one = homeSectionSchema.safeParse(section);
    return one.success && WORLD_SECTION_TYPES.includes(one.data.type) ? [one.data] : [];
  });
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
  },
  header: { menus: [], links: [], mobile: [] },
  footer: { discoverTitle: "", discover: [], newsletterTitle: "", newsletterNote: "", contactTitle: "", columns: [] },
  home: { sections: [] },
};

// ---------------------------------------------------------------- section catalog
export interface SectionKind {
  type: HomeSectionType;
  label: string;
  /** One line under the name in "Add Section" and on the section's card. */
  description: string;
  /** Only one of these makes sense on a page (the lead form, the tour tabs). */
  single?: boolean;
}

export const SECTION_KINDS: SectionKind[] = [
  { type: "hero", label: "Hero banners", description: "The big rotating banners at the top, with the title card.", single: true },
  { type: "tours", label: "Tour finder", description: "The category tiles, the trip-type pills, the search and the tour grid.", single: true },
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
      return { ...common, type, title: "", items: [] };
    case "banners":
      return { ...common, type, title: "", items: [] };
    case "reasons":
      return { ...common, type, title: "", items: [] };
    case "reviews":
      return { ...common, type, title: "", items: [] };
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
    case "banners":
    case "reasons":
    case "reviews":
      return [section.title, `${section.items.length} items`].filter(Boolean).join(" · ");
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
    return merged as unknown as SiteDocs[K];
  }
  // The other documents are flat forms: a document that does not parse opens empty rather than half-read.
  const second = SITE_DOC_SCHEMAS[key].safeParse(merged);
  return (second.success ? second.data : EMPTY_SITE_DOCS[key]) as SiteDocs[K];
}
