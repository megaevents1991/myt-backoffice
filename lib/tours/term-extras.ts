/**
 * What a term page (a world, a tag, a destination) came with from WordPress, as sections
 * staff can edit.
 *
 * The import kept, per term, the parts of the old Elementor archive templates that were
 * not the term's own fields: the "כל הסיבות לטייל איתנו" row, the artist / destination
 * sliders, and the "<destination> על קצה המזלג" summary (tours.cms_pages, kind "extras",
 * `data.terms["<kind>/<slug>"]`; the site reads the same JSON as content/archive-extras.json).
 * The site drew them on every such page, and the page's editor never showed them - "it is on
 * the page but not in the editor" (Alon, 08.10.2026). This module reads them into ordinary
 * sections with fixed ids (`x_reasons`, `x_slider`, `x_destSlider`, `x_summary`), which the
 * editor opens the page with (lib/tours/site-content.ts defaultTermLayout); once the page is
 * arranged and saved, the site draws only what the arranged page holds.
 *
 * Pure - no server or browser imports.
 */
import { TERM_EXTRA_IDS, type HomeSection, type TermExtrasSections } from "@/lib/tours/site-content";
import { mediaPath, simplifyHtml } from "@/lib/tours/wp-html";

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** The title the site writes above a reasons row that names none (mega-family components/archive/ReasonsRow.tsx). */
export const REASONS_TITLE = "כל הסיבות לטייל איתנו";
/** How many slides a banners section holds (lib/tours/site-content.ts bannersSection). */
const BANNERS_MAX = 8;

/** The reasons row of the page, as a Reasons section. */
function reasonsSection(value: unknown): HomeSection | null {
  const items = list(value)
    .map((item) => {
      const o = obj(item);
      return { icon: mediaPath(str(o.icon)), title: str(o.title), text: str(o.text) };
    })
    .filter((item) => item.title !== "" || item.text !== "")
    .slice(0, 8);
  if (!items.length) return null;
  return { id: TERM_EXTRA_IDS.reasons, visible: true, type: "reasons", title: REASONS_TITLE, items };
}

/** A slider of the page (picture, title, a line, a button, a link per slide), as a Banners section staff fill by hand. */
function bannersSection(id: string, value: unknown): HomeSection | null {
  const slider = obj(value);
  const items = list(slider.slides)
    .map((slide) => {
      const o = obj(slide);
      const href = str(o.href);
      return {
        title: str(o.title),
        subtitle: str(o.text),
        cta: str(o.button),
        href: href === "#" ? "" : href,
        newTab: false,
        image: mediaPath(str(o.image)),
        overlayColor: "",
        buttonColor: "",
      };
    })
    .filter((item) => item.title !== "" || item.image !== "")
    .slice(0, BANNERS_MAX);
  if (!items.length) return null;
  return { id, visible: true, type: "banners", title: str(slider.title), mode: "manual", source: "sale", term: "", tours: [], limit: 4, autoCta: "", items };
}

/** The "<destination> on a fingertip" block of a destination page, as a Destination summary section. */
function summarySection(value: unknown): HomeSection | null {
  const summary = obj(value);
  const blocks = list(summary.blocks)
    .map((block) => (typeof block === "string" ? simplifyHtml(block) : ""))
    .filter((block) => block !== "");
  const images = list(summary.gallery)
    .map((src) => mediaPath(str(src)))
    .filter((src) => src !== "")
    .slice(0, 10);
  const title = str(summary.title);
  if (!title && !blocks.length && !images.length) return null;
  const [intro = "", ...columns] = blocks;
  return { id: TERM_EXTRA_IDS.summary, visible: true, type: "summary", title, images, intro, columns: columns.slice(0, 3) };
}

/**
 * The sections one term page came with, each where the site has always drawn it:
 * the reasons row above the tour list; the sliders and the summary after the lead form.
 */
export function termExtrasSections(kind: string, slug: string, extrasRow: unknown): TermExtrasSections {
  const term = obj(obj(obj(extrasRow).terms)[`${kind}/${slug}`]);
  const beforeTours: HomeSection[] = [];
  const afterLead: HomeSection[] = [];
  const reasons = reasonsSection(term.reasons);
  if (reasons) beforeTours.push(reasons);
  const slider = bannersSection(TERM_EXTRA_IDS.slider, term.slider);
  if (slider) afterLead.push(slider);
  const destSlider = bannersSection(TERM_EXTRA_IDS.destSlider, term.destSlider);
  if (destSlider) afterLead.push(destSlider);
  const summary = summarySection(term.summary);
  if (summary) afterLead.push(summary);
  return { beforeTours, afterLead };
}

/**
 * Imported markup whose tags only wrap the text - Elementor's widget containers around
 * a term description, classes, data attributes - without the wrapping, so the visual
 * editor can hold it. Markup that carries more than the text (a picture, a table, an
 * embedded form) is returned as it is: the words would survive the simplification, the
 * rest would not.
 */
export function unwrapImportedHtml(html: string): string {
  if (/<\s*(img|picture|video|audio|iframe|table|form|svg|object|embed)\b/i.test(html)) return html;
  const simple = simplifyHtml(html);
  return words(simple) === words(html) ? simple : html;
}

const words = (html: string): string =>
  html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
