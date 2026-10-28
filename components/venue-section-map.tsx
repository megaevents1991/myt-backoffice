"use client";

import { useLayoutEffect, useMemo, useRef, type MouseEvent, type ReactNode } from "react";
import { normalizeSupplierCategory } from "@/lib/suppliers";
import {
  cleanupDuplicateSections,
  isSectionExcluded,
  isUnlabeledSectionId,
  sanitizeAndPrepareSvg,
  unlabeledSectionGroupId,
} from "@/lib/tixstock-map";
import { isUnsellableCategory, sectionCategory } from "@/lib/venue-maps/svg-zones";
import { cn } from "@/lib/utils";

// A hall's drawing (a TixStock SVG, or our copy of one) with its sections clickable - the tour uploader's classify
// dialog (round 2, Task 10). Drawn the way the event editor's exclude-sections map draws it: the SVG sanitized and
// prepared by `sanitizeAndPrepareSvg` (scripts and inline handlers stripped, unlabeled wedges numbered - the ids
// `tx_excluded_sections` holds), identical duplicate sections removed (`cleanupDuplicateSections`), and the editor's
// two looks: `svg-excluded` (red) on every section `isSectionExcluded` reads as excluded, `svg-highlighted` on the
// sections of `highlightCategory` - a category KEY (`normalizeSupplierCategory` of the section id's category slug,
// what the dialog's rows are keyed by). A click on a section calls `onToggle(sectionId, groupWedges)`; `groupWedges`
// = every numbered wedge of the clicked one's unlabeled group (the editor expands a legacy shared id with them -
// `toggleExcludedSection`), [] for a lettered section. The pitch, filler and disabled stands
// (`isUnsellableCategory`) carry no tickets and are not clickable.

/** The section under a point of the map - the topmost one: a label or an outline above the shape must not swallow the click. */
function sectionAt(container: HTMLElement, x: number, y: number): string | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (!container.contains(el)) continue;
    const id = el.closest("[data-section]")?.getAttribute("data-section");
    if (id) return id;
  }
  return null;
}

/** The category key of a section id ("lower-tier_101" -> "lower tier"). */
const keyOfSection = (sectionId: string): string => normalizeSupplierCategory(sectionCategory(sectionId));

export function VenueSectionMap({
  svg,
  excluded,
  highlightCategory,
  onToggle,
  disabled = false,
  className,
  fallback = null,
}: {
  svg: string;
  excluded: string[];
  highlightCategory: string | null;
  onToggle: (sectionId: string, groupWedges: string[]) => void;
  /** While saving: the map is drawn, clicks do nothing. */
  disabled?: boolean;
  className?: string;
  /** Shown instead of the map when the drawing is not a usable SVG. */
  fallback?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // DOMParser is a browser API: the map is only ever drawn after the dialog's action answered, never on the server.
  const prepared = useMemo(() => (typeof DOMParser === "undefined" ? null : sanitizeAndPrepareSvg(svg)), [svg]);

  // Once per drawing: the exact duplicates TixStock ships stacked on one another go (one click = one section).
  useLayoutEffect(() => {
    if (ref.current && prepared) cleanupDuplicateSections(ref.current);
  }, [prepared]);

  // The two looks, after every change of the list or the hovered row (the injected markup is never re-rendered by React).
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container || !prepared) return;
    for (const el of Array.from(container.querySelectorAll("[data-section]"))) {
      const id = el.getAttribute("data-section") ?? "";
      el.classList.toggle("svg-excluded", isSectionExcluded(id, excluded));
      el.classList.toggle("svg-highlighted", highlightCategory !== null && id !== "" && keyOfSection(id) === highlightCategory);
    }
  }, [prepared, excluded, highlightCategory]);

  if (!prepared) return <>{fallback}</>;

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const container = ref.current;
    // A link a drawing might wrap a section in never navigates: a click here only toggles.
    e.preventDefault();
    if (disabled || !container) return;
    const clicked = sectionAt(container, e.clientX, e.clientY);
    if (!clicked || isUnsellableCategory(keyOfSection(clicked))) return;
    const group = isUnlabeledSectionId(clicked) ? unlabeledSectionGroupId(clicked) : null;
    const wedges = group
      ? [
          ...new Set(
            Array.from(container.querySelectorAll("[data-section]"))
              .map((el) => el.getAttribute("data-section") ?? "")
              .filter((id) => isUnlabeledSectionId(id) && unlabeledSectionGroupId(id) === group),
          ),
        ]
      : [];
    onToggle(clicked, wedges);
  };

  return (
    <div
      data-disabled={disabled || undefined}
      className={cn("venue-section-map flex items-center justify-center rounded-md border bg-[hsl(var(--background))] p-2", className)}
    >
      {/* The event editor's map styles (events/[id]/page.tsx), scoped to this map. */}
      <style jsx global>{`
        .venue-section-map svg {
          direction: ltr;
        }
        .venue-section-map text,
        .venue-section-map tspan {
          pointer-events: none !important;
          user-select: none !important;
          fill: #f0f0f2 !important;
          font-weight: 600 !important;
          text-shadow: 0px 0px 3px #000000;
          font-family: Arial, Helvetica, sans-serif !important;
        }
        .venue-section-map .section-label {
          font-size: 10px !important;
        }
        .venue-section-map [data-section] {
          pointer-events: all !important;
          cursor: pointer !important;
        }
        .venue-section-map[data-disabled] [data-section] {
          cursor: default !important;
        }
        .venue-section-map [data-section] .block,
        .venue-section-map [data-section].block {
          fill: #277e89 !important;
          fill-opacity: 0.35 !important;
          stroke: #277e89 !important;
          stroke-opacity: 0.9 !important;
          stroke-width: 1px !important;
          vector-effect: non-scaling-stroke;
          transition: fill-opacity 0.2s ease, stroke-width 0.2s ease, stroke 0.2s ease;
        }
        .venue-section-map [data-section]:hover .block,
        .venue-section-map [data-section].block:hover {
          fill-opacity: 0.6 !important;
          stroke: #f0f0f2 !important;
          stroke-opacity: 1 !important;
          stroke-width: 1.5px !important;
        }
        .venue-section-map [data-section].svg-highlighted path,
        .venue-section-map [data-section].svg-highlighted rect,
        .venue-section-map [data-section].svg-highlighted polygon,
        .venue-section-map [data-section].svg-highlighted circle,
        .venue-section-map [data-section].svg-highlighted .block,
        .venue-section-map [data-section].svg-highlighted.block {
          fill: #277e89 !important;
          fill-opacity: 1 !important;
          stroke: #f0f0f2 !important;
          stroke-opacity: 1 !important;
          stroke-width: 2px !important;
          opacity: 1 !important;
        }
        .venue-section-map [data-section].svg-excluded path,
        .venue-section-map [data-section].svg-excluded rect,
        .venue-section-map [data-section].svg-excluded polygon,
        .venue-section-map [data-section].svg-excluded circle,
        .venue-section-map [data-section].svg-excluded .block,
        .venue-section-map [data-section].svg-excluded.block {
          fill: #e53e3e !important;
          fill-opacity: 0.7 !important;
          stroke: #fc8181 !important;
          stroke-opacity: 1 !important;
          stroke-width: 2px !important;
          opacity: 1 !important;
        }
      `}</style>
      <div
        ref={ref}
        dir="ltr"
        // `sanitizeAndPrepareSvg` sizes the drawing 100% x 100%: it fills this box and its viewBox keeps the proportions.
        className="h-full w-full [&>svg]:h-full [&>svg]:w-full"
        dangerouslySetInnerHTML={{ __html: prepared }}
        onClick={onClick}
      />
    </div>
  );
}
