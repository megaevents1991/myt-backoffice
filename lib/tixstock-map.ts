/**
 * TixStock Dynamic SVG Map utilities
 *
 * Handles SVG parsing, section matching, duplicate cleanup,
 * and visual highlighting for tx_event venue maps.
 */
/**
 * Parse raw SVG text, strip scripts / inline event handlers and
 * normalize text rendering so the authored label transforms stay intact.
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
/** Light solid fill for sections with available tickets — light Glow-Green
 *  tint (brand ramp), opaque to avoid stacking artefacts from overlaps. */
export const TX_SECTION_FILL_LIGHT = "#C2FFD8"; /* glow tint (brand ramp shade 1) */
/** Base/available section stroke — Glow Green */
export const TX_SECTION_FILL = "hsl(var(--brand-glow))";
/** Hover/highlighted stroke & text — secondary foreground */
export const TX_HOVER_STROKE = "#F0F0F2";
/** Text shadow on hover */
export const TX_TEXT_SHADOW = "#000000";
/** Hover feedback — solid Glow Green (brighter than the available tint) */
export const TX_HOVER_FILL = "hsl(var(--brand-glow))";
/** Brand Dark Forest Green for the selected section — clearly darker than
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

/** Normalise a section name for comparison */
export const normalizeSection = (section: string): string =>
  (section || "").trim().toLowerCase();

/* ------------------------------------------------------------------ */
/*  Ticket classification helpers                                      */
/* ------------------------------------------------------------------ */

/**
 * A ticket is "category-only" when its category and section fields
 * are identical (case-insensitive), meaning the listing has no
 * specific section — just a category.
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
/*  SVG sanitisation & preparation                                     */
/* ------------------------------------------------------------------ */

/**
 * Parse raw SVG text, strip scripts / inline event handlers and
 * enlarge tier-label fonts by 2 px.
 */
export const sanitizeAndPrepareSvg = (rawSvg: string): string | null => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawSvg, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) return null;

  // Remove <script> elements
  svg.querySelectorAll("script").forEach((n) => n.remove());

  // Remove inline event-handler attributes (onclick, onmouseover, …)
  svg.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((attr) => {
      if (attr.name.toLowerCase().startsWith("on"))
        el.removeAttribute(attr.name);
    });
  });

  // Remove tier-label elements (visual clutter on venue maps)
  svg.querySelectorAll(".tier-label").forEach((el) => el.remove());

  // Also remove standalone data-tier label elements that are NOT
  // ancestor groups containing sections (i.e. only remove if the
  // element has no [data-section] descendants).
  svg.querySelectorAll("[data-tier]").forEach((el) => {
    if (!el.querySelector("[data-section]")) el.remove();
  });

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

      if (excludedSections?.includes(secId)) {
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
    const shape =
      el.querySelector(".block") || el.querySelector(SVG_SHAPE_SEL) || el;
    const d = shape.getAttribute("d") || "";
    const points = shape.getAttribute("points") || "";
    const x = shape.getAttribute("x") || "";
    const y = shape.getAttribute("y") || "";
    const w = shape.getAttribute("width") || "";
    const h = shape.getAttribute("height") || "";
    const transform = shape.getAttribute("transform") || "";
    const sig = `${sectionId}|${shape.tagName}|${d}|${points}|${x}|${y}|${w}|${h}|${transform}`;

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
    const node = target as HTMLElement;
    const svgEl = target as unknown as SVGElement;

    switch (mode) {
      case "base":
      case "inactive":
        // Reset + no-ticket sections: neutral light gray, never the map's raw
        // (often black) fill — keeps the plan on-brand / off-white.
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
    const node = target as HTMLElement;
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
