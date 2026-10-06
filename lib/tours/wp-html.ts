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
export type EasyLayout = "legal" | "faq" | "faq_home";

export interface EasyText {
  /** A legal page: its whole text. */
  body: string;
  /** The FAQ home page: the heading above its opening text. */
  heading: string;
  /** A FAQ page: the opening text above the questions. */
  intro: string;
  /** A FAQ page: its topics, each a title and the text that opens under it. */
  faq: { q: string; a: string }[];
}

export const EMPTY_EASY: EasyText = { body: "", heading: "", intro: "", faq: [] };

/**
 * The imported pages of Mega Family whose text has a plain editor, by their address.
 * The other imported pages (the "about" pages, the group leaders, contact) are built
 * from heavier templates and keep the HTML editor.
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
};

/** The fields each layout edits. */
export const EASY_FIELDS: Record<EasyLayout, (keyof EasyText)[]> = {
  legal: ["body"],
  faq: ["intro", "faq"],
  faq_home: ["heading", "intro"],
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

function firstHeading(contentHtml: string): string {
  const re = /<h2[^>]*class="elementor-heading-title[^"]*"[^>]*>([\s\S]*?)<\/h2>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(contentHtml))) {
    const text = m[1].replace(/<[^>]+>/g, "").trim();
    if (text && !TEMPLATE_HEADINGS.has(text)) return text;
  }
  return "";
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

/** The text of an imported page as it came from WordPress, in the fields of its layout. */
export function easyFromHtml(layout: EasyLayout, contentHtml: string): EasyText {
  const html = contentHtml || "";
  switch (layout) {
    case "legal":
      return { ...EMPTY_EASY, body: textBlocks(html).join("") };
    case "faq":
      return { ...EMPTY_EASY, intro: textBlocks(html)[0] ?? "", faq: accordionItems(html) };
    case "faq_home":
      return { ...EMPTY_EASY, heading: firstHeading(html), intro: textBlocks(html)[0] ?? "" };
  }
}

const filled = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/**
 * The text the editor opens with: what staff saved before (tours.cms_pages.data.easy),
 * field by field, and for a field they never saved, what the page came with.
 */
export function readEasy(layout: EasyLayout, stored: unknown, contentHtml: string): EasyText {
  const saved = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const original = easyFromHtml(layout, contentHtml);
  const savedFaq = (Array.isArray(saved.faq) ? saved.faq : []).flatMap((item) => {
    const o = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return filled(o.q) ? [{ q: o.q.trim(), a: typeof o.a === "string" ? o.a : "" }] : [];
  });
  return {
    body: filled(saved.body) ? saved.body : original.body,
    heading: filled(saved.heading) ? saved.heading.trim() : original.heading,
    intro: filled(saved.intro) ? saved.intro : original.intro,
    faq: savedFaq.length ? savedFaq : original.faq,
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
  };
}
