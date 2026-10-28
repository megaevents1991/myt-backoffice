/**
 * TixStock Dynamic SVG Map utilities
 *
 * Handles SVG parsing, section matching, duplicate cleanup,
 * and visual highlighting for tx_event venue maps.
 */
/**
 * A supplier drawing reaches the page through `sanitizeAndPrepareSvg` only: an
 * ALLOWLIST of plain drawing elements and safe attributes (selftest
 * scripts/tixstock-map-selftest.ts), then the map preparation.
 */
/* ------------------------------------------------------------------ */

/** Re-export the canonical full listing type for callers that need it. */
export type { TixStockListing } from "./tixstock.types";

/**
 * Narrow shape used by the matching/painting helpers in this file.
 * Both the EventTicket adapter output and full canonical listings are
 * assignable to it (see `eventTicketToListing` and the live-pricing
 * fetch in `TicketSelection`).
 */
export type TixStockMatchableListing = {
  id: string;
  seat_details: {
    category?: string | null;
    section?: string | null;
    row?: string | null;
  };
  /** Optional numeric price used by the click-handler tie-breaker. */
  proceed_price?: number | null;
};

/* ------------------------------------------------------------------ */
/*  Colours                                                            */
/* ------------------------------------------------------------------ */

export const TX_TICKET_COLOR = "hsl(var(--brand-forest))";
/** Light solid fill for sections with available tickets - light Glow-Green
 *  tint (brand ramp), opaque to avoid stacking artefacts from overlaps. */
export const TX_SECTION_FILL_LIGHT =
  "#C2FFD8"; /* glow tint (brand ramp shade 1) */
/** Base/available section stroke - Glow Green */
export const TX_SECTION_FILL = "hsl(var(--brand-glow))";
/** Hover/highlighted stroke & text - secondary foreground */
export const TX_HOVER_STROKE = "#F0F0F2";
/** Text shadow on hover */
export const TX_TEXT_SHADOW = "#000000";
/** Hover feedback - solid Glow Green (brighter than the available tint) */
export const TX_HOVER_FILL = "hsl(var(--brand-glow))";
/** Brand Dark Forest Green for the selected section - clearly darker than
 *  the hover/available greens so a locked-in pick reads at a glance. */
export const TX_SELECTED_FILL = "hsl(var(--brand-forest))";
/** Fill for explicitly disabled/excluded sections */
export const TX_DISABLED_FILL = "#D8D8D8";
/** Stroke for explicitly disabled/excluded sections */
export const TX_DISABLED_STROKE = "#999999";

/* ------------------------------------------------------------------ */
/*  String helpers                                                     */
/* ------------------------------------------------------------------ */

/** Turn a category/section name into a slug for comparison */
export const slugify = (name: string): string =>
  (name || "").trim().toLowerCase().replace(/\s+/g, "-");

/* ------------------------------------------------------------------ */
/*  Ticket classification helpers                                      */
/* ------------------------------------------------------------------ */

/**
 * A ticket is "category-only" when its category and section fields
 * are identical (case-insensitive), meaning the listing has no
 * specific section - just a category.
 */
export const isCategoryOnlyTicket = (
  ticket: TixStockMatchableListing,
): boolean => {
  const c = ticket.seat_details.category?.trim().toLowerCase();
  const s = ticket.seat_details.section?.trim().toLowerCase();
  return !!c && !!s && c === s;
};

/**
 * Check whether a ticket's *section* matches a `data-section` id on
 * the SVG map.
 *
 * When the ticket also carries a category, we additionally require
 * the `data-section` id to begin with the category slug so that
 * e.g. section "92" in "Longside Upper Tier" only matches
 * `longside-upper-tier_92`, not `longside-upper-tier-central_92`.
 */
export const isTicketMatchingSection = (
  ticket: TixStockMatchableListing,
  mapSectionId: string,
  /** Optional: the data-category of the map section's parent group */
  mapCategoryId?: string | null,
): boolean => {
  const section = ticket.seat_details.section;
  if (!section || !mapSectionId) return false;

  const norm = slugify(section);
  const mapNorm = mapSectionId.toLowerCase();

  // Check suffix/infix match on the section id
  const sectionMatches =
    mapNorm === norm ||
    mapNorm.endsWith(`_${norm}`) ||
    mapNorm.endsWith(`-${norm}`) ||
    mapNorm.includes(`_${norm}_`) ||
    mapNorm.includes(`-${norm}-`);

  if (!sectionMatches) return false;

  // If the ticket has a distinct category, also verify the map
  // section belongs to the right category group.
  const ticketCat = ticket.seat_details.category?.trim().toLowerCase();
  if (ticketCat && ticketCat !== norm && mapCategoryId) {
    const catSlug = slugify(ticketCat);
    if (catSlug !== mapCategoryId.toLowerCase()) return false;
  }

  return true;
};

/**
 * Check whether a category-only ticket matches a `data-category` id
 * on the SVG map.
 */
export const isTicketMatchingCategory = (
  ticket: TixStockMatchableListing,
  mapCategoryId: string,
): boolean => {
  if (!isCategoryOnlyTicket(ticket)) return false;
  const ticketCategory = slugify(ticket.seat_details.category || "");
  return (
    !!ticketCategory && ticketCategory === (mapCategoryId || "").toLowerCase()
  );
};

/**
 * Check whether a category-only ticket matches a map section element.
 * Tries an explicit [data-category] group first, then falls back to
 * an exact [data-section] slug match.
 *
 * This strict fallback avoids cross-highlighting sibling categories
 * whose ids share a prefix, e.g. "fosse" vs "fosse-or-gauche".
 */
export const categoryOnlyMatchesEl = (
  ticket: TixStockMatchableListing,
  mapSectionId: string,
  mapCategoryId: string | null,
): boolean => {
  if (!isCategoryOnlyTicket(ticket)) return false;
  const ticketCatSlug = slugify(ticket.seat_details.category || "");
  if (!ticketCatSlug) return false;
  if (mapCategoryId && mapCategoryId.toLowerCase() === ticketCatSlug)
    return true;
  const sectionSlug = mapSectionId.toLowerCase();
  return sectionSlug === ticketCatSlug;
};

/**
 * Check whether a map section belongs to a ticket's category, regardless
 * of whether the ticket also has a specific section value.
 */
export const ticketCategoryMatchesEl = (
  ticket: TixStockMatchableListing,
  mapSectionId: string,
  mapCategoryId: string | null,
): boolean => {
  const ticketCatSlug = slugify(ticket.seat_details.category || "");
  if (!ticketCatSlug) return false;
  if (mapCategoryId && mapCategoryId.toLowerCase() === ticketCatSlug) {
    return true;
  }

  const sectionSlug = mapSectionId.toLowerCase();
  return sectionSlug === ticketCatSlug;
};

/**
 * Walk up the DOM from a `[data-section]` element and return the
 * enclosing `data-category` value (if any).
 */
export const getCategoryIdFromSectionEl = (
  sectionEl: Element,
): string | null => {
  const categoryEl = sectionEl.closest("[data-category]");
  return categoryEl?.getAttribute("data-category") || null;
};

/* ------------------------------------------------------------------ */
/*  Unlabeled sections                                                 */
/* ------------------------------------------------------------------ */

/**
 * Some TixStock maps leave wedges without a letter, so dozens of them share
 * one id like `lower-tier_` (AccorHotels Arena Paris: 16 per tier). Clicking
 * one in exclude mode used to toggle all of them. `numberUnlabeledSections`
 * gives each wedge its own id - `lower-tier_~1`, `lower-tier_~2`, ... - in
 * document order of the raw file, so every surface that loads the same SVG
 * (backoffice editor, portal wizard, main order page) numbers identically.
 *
 * `~` never appears in a TixStock section name, so these ids can't match a
 * ticket (unlabeled wedges have no tickets - excluding one is visual only).
 */
export const UNLABELED_SECTION_MARK = "~";

/** True for an id produced by `numberUnlabeledSections`. */
export const isUnlabeledSectionId = (sectionId: string): boolean =>
  sectionId.includes(`_${UNLABELED_SECTION_MARK}`);

/** `lower-tier_~3` → `lower-tier_`, the shared id the raw SVG carries. */
export const unlabeledSectionGroupId = (sectionId: string): string =>
  sectionId.slice(0, sectionId.lastIndexOf(`_${UNLABELED_SECTION_MARK}`) + 1);

/** Tag + geometry of a section's shape - identical copies share it. */
const sectionShapeSignature = (el: Element): string => {
  const shape =
    el.querySelector(".block") || el.querySelector(SVG_SHAPE_SEL) || el;
  return [
    shape.tagName,
    shape.getAttribute("d") || "",
    shape.getAttribute("points") || "",
    shape.getAttribute("x") || "",
    shape.getAttribute("y") || "",
    shape.getAttribute("width") || "",
    shape.getAttribute("height") || "",
    shape.getAttribute("transform") || "",
  ].join("|");
};

/**
 * Rename every `[data-section]` whose id ends in `_` (no letter) to a unique
 * numbered id. Exact geometric duplicates of one wedge keep one shared id so
 * duplicate cleanup still collapses them. Idempotent - numbered ids no longer
 * end in `_`.
 */
export const numberUnlabeledSections = (root: ParentNode): void => {
  const counters = new Map<string, number>();
  const bySignature = new Map<string, string>();

  for (const el of Array.from(root.querySelectorAll("[data-section]"))) {
    const id = el.getAttribute("data-section") || "";
    if (!id.endsWith("_")) continue;

    const signature = `${id}|${sectionShapeSignature(el)}`;
    let numbered = bySignature.get(signature);
    if (!numbered) {
      const n = (counters.get(id) ?? 0) + 1;
      counters.set(id, n);
      numbered = `${id}${UNLABELED_SECTION_MARK}${n}`;
      bySignature.set(signature, numbered);
    }
    el.setAttribute("data-section", numbered);
  }
};

/**
 * Whether a map section is excluded. Events saved before the numbering hold
 * the shared id (`upper-tier_`) - that still excludes every numbered wedge of
 * the group, until someone toggles one of them in the editor.
 */
export const isSectionExcluded = (
  sectionId: string,
  excludedSections?: string[] | null,
): boolean => {
  if (!sectionId || !excludedSections?.length) return false;
  if (excludedSections.includes(sectionId)) return true;
  return (
    isUnlabeledSectionId(sectionId) &&
    excludedSections.includes(unlabeledSectionGroupId(sectionId))
  );
};

/* ------------------------------------------------------------------ */
/*  SVG sanitisation & preparation                                     */
/* ------------------------------------------------------------------ */

/**
 * The elements a venue drawing may keep - an ALLOWLIST, by local name (case-sensitive, as SVG spells them). Anything
 * else goes with its whole subtree: `foreignObject` (an HTML integration point - an `<iframe srcdoc>` inside it runs
 * script in our origin once the markup is re-parsed by `innerHTML`), script, iframe / object / embed, image / video /
 * audio (external fetches), link / meta / base, form controls, the SMIL animations (`set` / `animate` can write an
 * `href`), `feImage`, `textPath`, and any element of another namespace. `a` is unwrapped (its children kept), `use`
 * stays only with an in-document `#fragment` href, `style` stays with its CSS cleaned (`cleanSvgCss`). The filter
 * primitives below fetch nothing and run nothing; they are kept so a drawing that shades its stands still renders (a
 * shape whose `filter` points at a removed filter may not draw at all).
 */
const SVG_ALLOWED_ELEMENTS = new Set([
  "svg", "g", "defs", "path", "polygon", "polyline", "rect", "circle", "ellipse", "line", "text", "tspan", "title",
  "desc", "clipPath", "mask", "linearGradient", "radialGradient", "stop", "symbol", "pattern", "marker", "use", "style",
  "filter", "feBlend", "feColorMatrix", "feComposite", "feDropShadow", "feFlood", "feGaussianBlur", "feMerge",
  "feMergeNode", "feMorphology", "feOffset",
]);
/** Elements whose content is text only: an element child of one (an HTML integration point for title / desc) goes. */
const SVG_TEXT_ONLY_ELEMENTS = new Set(["title", "desc", "style"]);
/** An in-document reference: `#id`. */
const SVG_FRAGMENT_REF = /^#[\w.:-]+$/;
/** Tokens no attribute value or style may carry once whitespace / control characters are taken out (`java\tscript:`). */
const SVG_UNSAFE_TOKENS = /javascript:|vbscript:|data:|expression\(|@import|-moz-binding|behavior/;
/** A `url(` that is not `url(#id)` - an external fetch (a beacon) or a script url. */
const SVG_EXTERNAL_URL = /url\((?!['"]?#[\w.:-]+['"]?\))/;

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;

/** A value with whitespace and control characters removed, lower-cased - what the unsafe checks read. */
const flattenSvgValue = (value: string): string =>
  // eslint-disable-next-line no-control-regex
  value.replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, "").toLowerCase();

/**
 * Would this attribute / style value fetch or run anything? A script or data url, an old-browser CSS hook, an external
 * `url(`, or a backslash (a CSS escape can spell any of them again: `u\72l(`).
 */
const isUnsafeSvgValue = (value: string): boolean => {
  const flat = flattenSvgValue(value);
  return SVG_UNSAFE_TOKENS.test(flat) || SVG_EXTERNAL_URL.test(flat) || flat.includes("\\");
};

/** An attribute's own name ("href" for `xlink:href`), lower-cased - in a browser and in linkedom alike. */
const svgAttrLocalName = (attr: Attr): string => {
  const name = attr.name.toLowerCase();
  const colon = name.lastIndexOf(":");
  return colon === -1 ? name : name.slice(colon + 1);
};

/**
 * A supplier `<style>` kept (maps colour their sections by class), cleaned: `@import` rules out, every `url(...)` that
 * is not `url(#id)` replaced by `none`, `expression(` / `behavior` / `-moz-binding` / `javascript:` taken out. null =
 * something unsafe is still there (an escape, a broken url) - the whole style element goes.
 */
export const cleanSvgCss = (css: string): string | null => {
  const cleaned = css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (match: string, _quote: string, ref: string) =>
      SVG_FRAGMENT_REF.test(ref.trim()) ? match : "none",
    )
    .replace(/expression\s*\(/gi, "")
    .replace(/-moz-binding/gi, "")
    .replace(/behavior/gi, "")
    .replace(/javascript\s*:/gi, "");
  return isUnsafeSvgValue(cleaned) ? null : cleaned;
};

/** Drop every attribute that could run or fetch something: `on*`, `src` / `srcdoc` / `srcset`, an href that is not `#id`, an unsafe value. */
const cleanSvgAttributes = (el: Element): void => {
  for (const attr of Array.from(el.attributes)) {
    const local = svgAttrLocalName(attr);
    const drop =
      local.startsWith("on") ||
      local === "src" ||
      local === "srcdoc" ||
      local === "srcset" ||
      (local === "href" && !SVG_FRAGMENT_REF.test(attr.value.trim())) ||
      isUnsafeSvgValue(attr.value);
    if (drop) el.removeAttribute(attr.name);
  }
};

/** A `use` whose (only) target is an in-document `#id` - the only kind kept. */
const isFragmentUse = (el: Element): boolean => {
  const refs = Array.from(el.attributes).filter((attr) => svgAttrLocalName(attr) === "href");
  return refs.length > 0 && refs.every((attr) => SVG_FRAGMENT_REF.test(attr.value.trim()));
};

/**
 * Sanitize a parsed drawing IN PLACE by the allowlist above. `a` elements are unwrapped first; then every element is
 * kept only when its local name is allowed and it sits in the drawing's own namespace (the root `<svg>`'s - the SVG
 * namespace, or none for a file without `xmlns`); comments and processing instructions go; text-only elements keep
 * their text alone; a kept `style` has its CSS cleaned; every kept element's attributes are cleaned.
 */
const sanitizeSvgTree = (svg: Element): void => {
  const ns = svg.namespaceURI;
  const sameNs = (el: Element): boolean => el.namespaceURI === ns;

  for (const link of Array.from(svg.querySelectorAll("a"))) {
    const parent = link.parentNode;
    if (!parent) continue;
    while (link.firstChild) parent.insertBefore(link.firstChild, link);
    parent.removeChild(link);
  }

  cleanSvgAttributes(svg);
  const stack: Element[] = [svg];
  while (stack.length > 0) {
    const el = stack.pop();
    if (!el) break;
    const textOnly = SVG_TEXT_ONLY_ELEMENTS.has(el.localName);
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === TEXT_NODE || child.nodeType === CDATA_SECTION_NODE) continue;
      if (child.nodeType !== ELEMENT_NODE || textOnly) {
        el.removeChild(child);
        continue;
      }
      const kid = child as Element;
      const allowed = SVG_ALLOWED_ELEMENTS.has(kid.localName) && sameNs(kid) && (kid.localName !== "use" || isFragmentUse(kid));
      if (!allowed) {
        el.removeChild(kid);
        continue;
      }
      cleanSvgAttributes(kid);
      stack.push(kid);
    }
    if (el.localName === "style") {
      const css = cleanSvgCss(el.textContent ?? "");
      if (css === null) el.parentNode?.removeChild(el);
      else el.textContent = css;
    }
  }
};

/**
 * Parse raw SVG text, sanitize it by an ALLOWLIST (`sanitizeSvgTree`: only plain drawing elements, no handler, no
 * external or script url, a cleaned `<style>` - the markup is injected with `dangerouslySetInnerHTML`), then prepare
 * it: tier labels out, unlabeled wedges numbered, sized 100%, a text style injected. null = not an SVG.
 */
export const sanitizeAndPrepareSvg = (rawSvg: string): string | null => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawSvg, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) return null;

  sanitizeSvgTree(svg);

  // Remove tier-label elements (visual clutter on venue maps)
  svg.querySelectorAll(".tier-label").forEach((el) => el.remove());

  // Also remove standalone data-tier label elements that are NOT
  // ancestor groups containing sections (i.e. only remove if the
  // element has no [data-section] descendants).
  svg.querySelectorAll("[data-tier]").forEach((el) => {
    if (!el.querySelector("[data-section]")) el.remove();
  });

  // One id per unlabeled wedge, so exclude/hover/click act on it alone
  numberUnlabeledSections(svg);

  // Make the SVG responsive
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.removeAttribute("style");
  // Ensure LTR text direction inside the SVG regardless of surrounding page direction
  svg.setAttribute("direction", "ltr");

  // Force stable text metrics with an injected override stylesheet.
  // Preserving the SVG-authored transforms avoids the slight label drift
  // introduced by runtime re-centering against fallback fonts.
  const styleEl = doc.createElementNS("http://www.w3.org/2000/svg", "style");
  styleEl.textContent = `
    text,
    tspan {
      pointer-events: none !important;
      user-select: none !important;
      font-family: Arial, Helvetica, sans-serif !important;
      direction: ltr;
      unicode-bidi: isolate;
    }

    .section-label {
      font-size: 10px !important;
    }
  `;
  svg.appendChild(styleEl);

  return svg.outerHTML;
};

/* ------------------------------------------------------------------ */
/*  SVG pre-painting                                                   */
/* ------------------------------------------------------------------ */

/**
 * Pre-paint the SVG string so sections have correct fill/stroke from
 * the moment they are injected into the DOM via `dangerouslySetInnerHTML`.
 *
 * This eliminates the flash of unstyled content that occurs when painting
 * relies on effects / layout effects, which may not fire reliably in all
 * environments (e.g. SSG pages on Vercel).
 *
 * Only applies the static "available" / "inactive" styles.
 * Dynamic states (hover, selected) are handled by the component's
 * runtime effects.
 */
export const prePaintSvg = (
  svgHtml: string,
  tickets: TixStockMatchableListing[],
  excludedSections?: string[],
  disabledTicketIds?: Set<string>,
): string => {
  if (!svgHtml || typeof DOMParser === "undefined") return svgHtml;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgHtml, "image/svg+xml");
    const svg = doc.querySelector("svg");
    if (!svg) return svgHtml;

    const sectionEls = Array.from(svg.querySelectorAll("[data-section]"));

    for (const el of sectionEls) {
      const secId = el.getAttribute("data-section") || "";
      const catId = getCategoryIdFromSectionEl(el);

      if (isSectionExcluded(secId, excludedSections)) {
        paintSection(el, "disabled");
        continue;
      }

      const matchingTickets = tickets.filter((t) => {
        if (isCategoryOnlyTicket(t)) {
          return categoryOnlyMatchesEl(t, secId, catId);
        }
        return isTicketMatchingSection(t, secId, catId);
      });

      const hasEnabledTicket = matchingTickets.some(
        (t) => !disabledTicketIds?.has(t.id),
      );
      const hasDisabledTicket = matchingTickets.some((t) =>
        disabledTicketIds?.has(t.id),
      );

      if (hasEnabledTicket) {
        paintSection(el, "available");
      } else if (hasDisabledTicket) {
        paintSection(el, "disabled");
      } else {
        paintSection(el, "inactive");
      }
    }

    return svg.outerHTML;
  } catch (e) {
    console.error("[prePaintSvg] Failed to pre-paint SVG:", e);
    return svgHtml;
  }
};

/* ------------------------------------------------------------------ */
/*  Duplicate section cleanup                                          */
/* ------------------------------------------------------------------ */

/**
 * Remove duplicate `[data-section]` elements that share the same
 * section id **and** identical geometry (tag + d/points/rect attrs +
 * transform).  This avoids visual artefacts in some TixStock SVGs.
 */
export const cleanupDuplicateSections = (container: HTMLElement): void => {
  const sectionEls = Array.from(container.querySelectorAll("[data-section]"));
  const seen = new Set<string>();

  for (const el of sectionEls) {
    const sectionId = el.getAttribute("data-section") || "";

    // Geometry lives on the section's shape child (e.g. `.block`), not on
    // the `[data-section]` wrapper group itself. Read it from the shape so
    // sections that share an id (e.g. many `platea_` blocks) are not all
    // collapsed to one signature and wrongly removed.
    const sig = `${sectionId}|${sectionShapeSignature(el)}`;

    if (seen.has(sig)) {
      el.remove();
      continue;
    }
    seen.add(sig);
  }
};

/* ------------------------------------------------------------------ */
/*  Section painting                                                   */
/* ------------------------------------------------------------------ */

/**
 * Paint a `[data-section]` group.
 *
 * Fill is applied to `.block` children (or all shapes as fallback).
 * Stroke is applied to **every** shape element inside the section so
 * that border colour is always consistent (fixes sections whose
 * outlines live in non-`.block` paths).
 *
 * mode:
 *  - "base"      → restore original styles
 *  - "available"  → light solid teal fill + secondary stroke
 *  - "hover"      → brighter teal + light stroke
 *  - "selected"   → darker teal + light stroke
 *  - "inactive"   → no fill change, subtle secondary-colour border
 *  - "disabled"   → gray fill + gray stroke, not-allowed cursor
 */

const SVG_SHAPE_SEL = "polygon, path, rect, circle, ellipse, polyline, line";

export const paintSection = (
  el: Element,
  mode: "base" | "hover" | "selected" | "available" | "inactive" | "disabled",
): void => {
  const blocks = el.querySelectorAll(".block");
  const allShapes = Array.from(el.querySelectorAll(SVG_SHAPE_SEL));

  // Fill targets: .block elements if present, otherwise all shapes
  const fillTargets =
    blocks.length > 0
      ? Array.from(blocks)
      : allShapes.length > 0
        ? allShapes
        : [el];

  // Stroke targets: ALL shapes so borders are always overridden
  const strokeTargets = allShapes.length > 0 ? allShapes : [el];

  // Deduplicate for persisting originals
  const allTargets = [...new Set<Element>([...fillTargets, ...strokeTargets])];

  // Persist original inline styles the first time we touch an element
  for (const target of allTargets) {
    const node = target as HTMLElement;
    const svgEl = target as unknown as SVGElement;
    if (!node.dataset.origFill) {
      node.dataset.origFill = svgEl.style.fill || "";
    }
    if (!node.dataset.origStroke) {
      node.dataset.origStroke = svgEl.style.stroke || "";
    }
    if (!node.dataset.origStrokeOpacity) {
      node.dataset.origStrokeOpacity = svgEl.style.strokeOpacity || "";
    }
    if (!node.dataset.origFillOpacity) {
      node.dataset.origFillOpacity = svgEl.style.fillOpacity || "";
    }
  }

  /* ---- fill ---- */
  for (const target of fillTargets) {
    const svgEl = target as unknown as SVGElement;

    switch (mode) {
      case "base":
      case "inactive":
        // Reset + no-ticket sections: neutral light gray, never the map's raw
        // (often black) fill - keeps the plan on-brand / off-white.
        svgEl.style.fill = "#E8E6E0";
        svgEl.style.opacity = "1";
        svgEl.style.cursor = "";
        break;
      case "available":
        svgEl.style.fill = TX_SECTION_FILL_LIGHT;
        svgEl.style.fillOpacity = "1";
        svgEl.style.opacity = "1";
        svgEl.style.cursor = "pointer";
        break;
      case "hover":
        svgEl.style.fill = TX_HOVER_FILL;
        svgEl.style.fillOpacity = "1";
        svgEl.style.opacity = "1";
        svgEl.style.cursor = "pointer";
        break;
      case "selected":
        svgEl.style.fill = TX_SELECTED_FILL;
        svgEl.style.fillOpacity = "1";
        svgEl.style.opacity = "1";
        svgEl.style.cursor = "pointer";
        break;
      case "disabled":
        svgEl.style.fill = TX_DISABLED_FILL;
        svgEl.style.fillOpacity = "1";
        svgEl.style.opacity = "0.6";
        svgEl.style.cursor = "not-allowed";
        break;
    }
  }

  /* ---- stroke ---- */
  for (const target of strokeTargets) {
    const svgEl = target as unknown as SVGElement;

    switch (mode) {
      case "base":
        svgEl.style.stroke = "#D3D1CA";
        svgEl.style.strokeOpacity = "0.8";
        break;
      case "available":
        svgEl.style.stroke = TX_SECTION_FILL;
        svgEl.style.strokeOpacity = "";
        break;
      case "hover":
        svgEl.style.stroke = TX_HOVER_STROKE;
        svgEl.style.strokeOpacity = "";
        break;
      case "selected":
        svgEl.style.stroke = TX_HOVER_STROKE;
        svgEl.style.strokeOpacity = "";
        break;
      case "inactive":
        svgEl.style.stroke = "#D3D1CA";
        svgEl.style.strokeOpacity = "0.8";
        break;
      case "disabled":
        svgEl.style.stroke = TX_DISABLED_STROKE;
        svgEl.style.strokeOpacity = "0.6";
        break;
    }
  }

  // Style the section-label text on hover/selected
  const labels = el.querySelectorAll(".section-label");
  for (const label of Array.from(labels)) {
    const txtEl = label as SVGTextElement;
    if (mode === "hover" || mode === "selected") {
      txtEl.style.fill = TX_HOVER_STROKE;
      txtEl.style.textShadow = `0 1px 2px ${TX_TEXT_SHADOW}`;
    } else {
      txtEl.style.fill = "";
      txtEl.style.textShadow = "";
    }
  }
};

/* ------------------------------------------------------------------ */
/*  EventTicket → TixStockListing adapter                              */
/* ------------------------------------------------------------------ */

/**
 * Convert our internal `EventTicket` shape (category + description)
 * into the `TixStockListing` shape expected by the map utilities.
 *
 * ticket.category → seat_details.category  (the TixStock category name)
 * ticket.category → seat_details.section   (same value: EventTicket has no section field,
 *                                           so we treat every ticket as category-only)
 */
export const eventTicketToListing = (ticket: {
  id: string;
  category: string;
  description: string;
  price: number;
}): TixStockMatchableListing => ({
  id: ticket.id,
  proceed_price: ticket.price,
  seat_details: {
    category: ticket.category,
    section: ticket.category, // category-only: no per-section data in EventTicket
  },
});

/* ------------------------------------------------------------------ */
/*  Map-match validation                                               */
/* ------------------------------------------------------------------ */

/**
 * Check whether a ticket can be matched to *any* section/category on
 * the loaded SVG map.  Used to filter out tickets that have no
 * corresponding visual representation.
 */
export const doesTicketMatchAnyMapSection = (
  ticket: TixStockMatchableListing,
  container: HTMLElement,
): boolean => {
  const sectionEls = Array.from(container.querySelectorAll("[data-section]"));

  return sectionEls.some((el) => {
    const secId = el.getAttribute("data-section") || "";
    const catId = getCategoryIdFromSectionEl(el);

    if (isCategoryOnlyTicket(ticket)) {
      return categoryOnlyMatchesEl(ticket, secId, catId);
    }
    return isTicketMatchingSection(ticket, secId, catId);
  });
};
