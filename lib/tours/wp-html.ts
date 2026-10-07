/**
 * The text of a page imported from WordPress, without its HTML.
 *
 * The imported pages keep their Elementor markup in tours.cms_pages.content_html,
 * and the site picks its text out of it (mega-family components/pages/wp.ts). That
 * markup cannot be edited by hand, so for the pages whose layout is simple - the
 * legal pages, the FAQ pages - the editor shows only the text: this module reads it
 * out of the markup the same way the site does, in the small vocabulary the visual
 * editor knows (paragraphs, headings, lists, links, bold, italic).
 *
 * What staff save goes to tours.cms_pages.data.easy; the site prefers it over what
 * it digs out itself (wp.ts easyText). The markup is never rewritten, so removing
 * `easy` brings the page back exactly as it was imported.
 *
 * Pure - no server or browser imports.
 */
import { stripActiveHtml } from "@/lib/tours/site-content";

/** How the site draws the page, which decides the fields its text is edited in. */
export type EasyLayout = "legal" | "faq" | "faq_home" | "about" | "contact" | "form_page" | "blog" | "leaders";

export interface EasyText {
  /** A legal page: its whole text. An "about" page: the text beside the picture. */
  body: string;
  /** The heading above the text (FAQ home, about, contact, blog); on the leaders page, the line under the page title. */
  heading: string;
  /** The opening text: above the questions of a FAQ page, above the form of the contact and cancellation pages, above the posts of the blog. */
  intro: string;
  /** A FAQ page: its topics, each a title and the text that opens under it. */
  faq: { q: string; a: string }[];
  /** The second heading of the page: above the contact form, above the closing text of the leaders page. */
  heading2: string;
  /** The text under the form (cancellation page) or under the leaders (leaders page). */
  after: string;
  /** An "about" page: the picture beside the text, and what it shows (for screen readers). */
  image: string;
  imageAlt: string;
}

export const EMPTY_EASY: EasyText = { body: "", heading: "", intro: "", faq: [], heading2: "", after: "", image: "", imageAlt: "" };

/**
 * The imported pages of Mega Family whose text has a plain editor, by their address.
 * Every imported page that has words of its own is here; `easyLayoutOfPath` adds the
 * "about" pages by their folder.
 */
export const EASY_PAGE_LAYOUTS: Record<string, EasyLayout> = {
  "/accessability/": "legal",
  "/cancellation-policy/": "legal",
  "/cancellation-policy-tours/": "legal",
  "/privacy-terms/": "legal",
  "/terms-and-conditions/": "legal",
  "/faq-mega-family/": "faq",
  "/faq-noya-holidays/": "faq",
  "/faq-organized-for-public/": "faq",
  "/faq-attractions-and-events/": "faq",
  "/faq/": "faq_home",
  "/contact/": "contact",
  "/cancellation-form/": "form_page",
  "/mega-blog/": "blog",
  "/מלווי-הקבוצות-שלנו/": "leaders",
};

/** The plain-editor layout of an imported page, by its address; null = the page has none. */
export function easyLayoutOfPath(path: string): EasyLayout | null {
  if (path === "/about/" || /^\/about\/[^/]+\/$/.test(path)) return "about";
  return EASY_PAGE_LAYOUTS[path] ?? null;
}

/** The fields each layout edits. */
export const EASY_FIELDS: Record<EasyLayout, (keyof EasyText)[]> = {
  legal: ["body"],
  faq: ["intro", "faq"],
  faq_home: ["heading", "intro"],
  about: ["heading", "body", "image", "imageAlt"],
  contact: ["heading", "intro", "heading2"],
  form_page: ["intro", "after"],
  blog: ["heading", "intro"],
  leaders: ["heading", "heading2", "after"],
};

export interface PageNote {
  /** Why this page has no text to edit here, in plain words. */
  note: string;
  /** The backoffice screen that manages its content, when there is one. */
  href?: string;
  linkLabel?: string;
  /** An address of the old WordPress shop: the site only redirects it, and the Content Pages list leaves it out. */
  retired?: boolean;
}

const OLD_SHOP_NOTE = "This address belonged to the shop of the old site. The site sends its visitors to the home page, so there is nothing to edit here.";

/** Imported addresses that have no words of their own, and where their content is managed instead. */
export const PAGE_NOTES: Record<string, PageNote> = {
  "/": {
    note: "The home page is built section by section in Website > Homepage. Only its SEO title and description are edited here.",
    href: "/tours/homepage",
    linkLabel: "Open Homepage",
  },
  "/cart/": { note: OLD_SHOP_NOTE, retired: true },
  "/checkout/": { note: OLD_SHOP_NOTE, retired: true },
  "/my-account/": { note: OLD_SHOP_NOTE, retired: true },
  "/shop/": { note: OLD_SHOP_NOTE, retired: true },
};

/**
 * What the site itself prints on a page whose words are not in its imported markup: the
 * text the plain editor opens with until staff write their own. The site holds the same
 * words (mega-family app/contact, app/mega-blog, content/archive-extras.json) - a change
 * there without one here only changes what an untouched editor shows.
 */
const BUILT_IN_TEXT: Partial<Record<EasyLayout, Partial<EasyText>>> = {
  contact: { heading: "לא מצאתם את מה שחיפשתם?", heading2: "כתבו לנו ונמצא חופשה במיוחד בשבילכם" },
  blog: {
    heading: "מגה בלוג - מסביב לעולם עם מגה תיירות",
    intro: "<p>המלצות, חוויות, טיפים על הטיולים שלנו והיעדים הקסומים.</p><p>מדי שבוע תעלה כתבה חדשה לבלוג שלנו, ממליצים לכם להישאר מעודכנים!</p>",
  },
  leaders: { heading: "הכירו את צוות המלווים והמלוות המסור שלנו", heading2: "לא מצאתם את מה שחיפשתם?" },
};

// ---------------------------------------------------------------- reading the Elementor markup (as wp.ts does)
/** Inner HTML of the <div> whose opening tag starts at `start` (balanced div matching). */
function innerOf(html: string, start: number): string {
  const open = html.indexOf(">", start) + 1;
  const re = /<(\/?)div\b/gi;
  re.lastIndex = open;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(open, m.index);
  }
  return html.slice(open);
}

/** Inner HTML of every `.elementor-widget-<kind>` widget, in document order. */
function widgets(html: string, kind: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<div[^>]*\\belementor-widget-${kind}(?=[\\s"])[^>]*>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(innerOf(html, m.index));
  return out;
}

/** Elementor sometimes wraps widget output in `.elementor-widget-container`; unwrap it. */
function unwrap(widget: string): string {
  const i = widget.indexOf('<div class="elementor-widget-container">');
  return (i === -1 ? widget : innerOf(widget, i)).trim();
}

/** Legacy WordPress links that have no `/info/` prefix on the site, and stray absolute links. */
function fixLinks(html: string): string {
  return html
    .replace(/href="\/info\//g, 'href="/')
    .replace(/href="https?:\/\/newsite\.megatr\.co\.il\/info\//g, 'href="/')
    .replace(/href="https?:\/\/newsite\.megatr\.co\.il\//g, 'href="/');
}

const SIMPLE_TAGS = new Set(["p", "br", "strong", "b", "em", "i", "ul", "ol", "li", "a", "h1", "h2", "h3", "blockquote"]);

/**
 * Markup as the visual editor can hold it: the tags it knows, without attributes
 * (a link keeps its address). A smaller heading becomes its smallest heading; any
 * other tag is dropped and its content stays.
 */
export function simplifyHtml(html: string): string {
  return fixLinks(html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\s*(script|style)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<(\/?)h[4-6]\b[^>]*>/gi, "<$1h3>")
    .replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (_whole, close: string, name: string, attrs: string) => {
      const tag = name.toLowerCase();
      if (!SIMPLE_TAGS.has(tag)) return "";
      if (close) return `</${tag}>`;
      if (tag === "br") return "<br>";
      if (tag !== "a") return `<${tag}>`;
      const href = /\bhref\s*=\s*("[^"]*"|'[^']*')/i.exec(attrs)?.[1];
      if (!href) return "<a>";
      return /\btarget\s*=\s*["']?_blank/i.test(attrs) ? `<a href=${href} target="_blank" rel="noopener noreferrer">` : `<a href=${href}>`;
    })
    .replace(/<p>\s*(&nbsp;|\s)*<\/p>/g, "")
    .trim();
}

/** Text-editor blocks of the page body (template wrappers such as the CTA tiles are skipped). */
function textBlocks(contentHtml: string): string[] {
  return widgets(contentHtml, "text-editor")
    .map(unwrap)
    .filter((h) => !h.includes('class="elementor-template"'))
    .map(simplifyHtml);
}

/** Headings that belong to shared Elementor templates, not to the page body. */
const TEMPLATE_HEADINGS = new Set(["סינון אודות", "הכי חמים במגה פמילי", "בחרו את סוג הטיול שלכם..."]);

/** The h2 headings of the page body, in order, without the ones of shared templates. */
function bodyHeadings(contentHtml: string): string[] {
  const out: string[] = [];
  const re = /<h2[^>]*class="elementor-heading-title[^"]*"[^>]*>([\s\S]*?)<\/h2>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(contentHtml))) {
    const text = m[1].replace(/<[^>]+>/g, "").trim();
    if (text && !TEMPLATE_HEADINGS.has(text)) out.push(text);
  }
  return out;
}

const firstHeading = (contentHtml: string): string => bodyHeadings(contentHtml)[0] ?? "";

/** A WordPress upload address as the site serves it: /media/<year>/<month>/<file>, in its original size. */
export function mediaPath(url: string): string {
  const at = url.indexOf("/wp-content/uploads/");
  if (at === -1) return url;
  let rel = url.slice(at + "/wp-content/uploads/".length);
  try {
    rel = decodeURIComponent(rel);
  } catch {
    // an address that does not decode keeps its raw form
  }
  return ("/media/" + rel).replace(/-\d{2,4}x\d{2,4}(\.[a-z0-9]+)$/i, "$1");
}

/** The first picture of the page body (an Elementor image widget), as the site resolves it. */
function bodyImage(contentHtml: string): { src: string; alt: string } {
  for (const widget of widgets(contentHtml, "image")) {
    const img = /<img[^>]*\bsrc="([^"]+)"[^>]*>/.exec(widget);
    if (!img) continue;
    return { src: mediaPath(img[1]), alt: /\balt="([^"]*)"/.exec(img[0])?.[1] ?? "" };
  }
  return { src: "", alt: "" };
}

/** Items of the first Elementor nested accordion (`<details class="e-n-accordion-item">`). */
function accordionItems(contentHtml: string): { q: string; a: string }[] {
  const [accordion] = widgets(contentHtml, "n-accordion");
  if (!accordion) return [];
  const items: { q: string; a: string }[] = [];
  for (const part of accordion.split(/<details\b/).slice(1)) {
    const title = /e-n-accordion-item-title-text">\s*([\s\S]*?)\s*<\/div>/.exec(part);
    if (!title) continue;
    items.push({ q: title[1].replace(/<[^>]+>/g, "").trim(), a: widgets(part, "text-editor").map(unwrap).map(simplifyHtml).join("") });
  }
  return items;
}

/**
 * The words of the leaders page as the site holds them (the "extras" row of
 * tours.cms_pages, `data.instructorsPage`): its line under the title, and the closing
 * heading and text. Anything missing falls back to the built-in words.
 */
export function leadersSiteText(extras: unknown): Partial<EasyText> {
  const root = extras && typeof extras === "object" && !Array.isArray(extras) ? (extras as Record<string, unknown>) : {};
  const page = root.instructorsPage && typeof root.instructorsPage === "object" ? (root.instructorsPage as Record<string, unknown>) : {};
  const out: Partial<EasyText> = {};
  const subtitle = Array.isArray(page.subtitle) ? page.subtitle.filter((line): line is string => typeof line === "string").join(" ") : page.subtitle;
  if (filled(subtitle)) out.heading = subtitle.trim();
  if (filled(page.notFoundTitle)) out.heading2 = page.notFoundTitle.trim();
  if (filled(page.notFoundHtml)) out.after = simplifyHtml(page.notFoundHtml);
  return out;
}

/**
 * The text of an imported page as it came from WordPress, in the fields of its layout.
 * `siteText` = words the site keeps outside the page's markup (the leaders page).
 */
export function easyFromHtml(layout: EasyLayout, contentHtml: string, siteText: Partial<EasyText> = {}): EasyText {
  const html = contentHtml || "";
  switch (layout) {
    case "legal":
      return { ...EMPTY_EASY, body: textBlocks(html).join("") };
    case "faq":
      return { ...EMPTY_EASY, intro: textBlocks(html)[0] ?? "", faq: accordionItems(html) };
    case "faq_home":
      return { ...EMPTY_EASY, heading: firstHeading(html), intro: textBlocks(html)[0] ?? "" };
    case "about": {
      const image = bodyImage(html);
      return { ...EMPTY_EASY, heading: firstHeading(html), body: textBlocks(html)[0] ?? "", image: image.src, imageAlt: image.alt };
    }
    case "contact": {
      const [first, second] = bodyHeadings(html);
      const builtIn = BUILT_IN_TEXT.contact ?? {};
      return { ...EMPTY_EASY, heading: first || builtIn.heading || "", intro: textBlocks(html)[0] ?? "", heading2: second || builtIn.heading2 || "" };
    }
    case "form_page": {
      const [before = "", after = ""] = textBlocks(html);
      return { ...EMPTY_EASY, intro: before, after };
    }
    case "blog":
    case "leaders":
      // the site prints these words itself; the markup of the page does not hold them
      return { ...EMPTY_EASY, ...BUILT_IN_TEXT[layout], ...siteText };
  }
}

function filled(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * The text the editor opens with: what staff saved before (tours.cms_pages.data.easy),
 * field by field, and for a field they never saved, what the page came with.
 */
export function readEasy(layout: EasyLayout, stored: unknown, contentHtml: string, siteText: Partial<EasyText> = {}): EasyText {
  const saved = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const original = easyFromHtml(layout, contentHtml, siteText);
  const savedFaq = (Array.isArray(saved.faq) ? saved.faq : []).flatMap((item) => {
    const o = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return filled(o.q) ? [{ q: o.q.trim(), a: typeof o.a === "string" ? o.a : "" }] : [];
  });
  return {
    body: filled(saved.body) ? saved.body : original.body,
    heading: filled(saved.heading) ? saved.heading.trim() : original.heading,
    intro: filled(saved.intro) ? saved.intro : original.intro,
    faq: savedFaq.length ? savedFaq : original.faq,
    heading2: filled(saved.heading2) ? saved.heading2.trim() : original.heading2,
    after: filled(saved.after) ? saved.after : original.after,
    image: filled(saved.image) ? saved.image.trim() : original.image,
    imageAlt: filled(saved.imageAlt) ? saved.imageAlt.trim() : original.imageAlt,
  };
}

/** What a save keeps of the editor's text: the fields of the page's layout, with anything active stripped. */
export function cleanEasy(layout: EasyLayout, input: EasyText): EasyText {
  const fields = EASY_FIELDS[layout];
  const html = (value: string) => stripActiveHtml(value).trim();
  return {
    body: fields.includes("body") ? html(input.body) : "",
    heading: fields.includes("heading") ? input.heading.trim() : "",
    intro: fields.includes("intro") ? html(input.intro) : "",
    faq: fields.includes("faq") ? input.faq.map((item) => ({ q: item.q.trim(), a: html(item.a) })).filter((item) => item.q !== "") : [],
    heading2: fields.includes("heading2") ? input.heading2.trim() : "",
    after: fields.includes("after") ? html(input.after) : "",
    image: fields.includes("image") ? input.image.trim() : "",
    imageAlt: fields.includes("imageAlt") ? input.imageAlt.trim() : "",
  };
}
