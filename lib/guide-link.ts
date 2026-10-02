// Where in /guide a screen is explained. Pure - shared by the top bar's
// "Guide" button (every screen) and the guide itself (its anchors), so the
// two can never disagree. scripts/guide-selftest.ts checks every menu screen
// of every product type.

import { DEFAULT_PRODUCT_TYPES, navFor } from "@/lib/nav";
// Type only - lib/company.ts is server code and must not reach the client bundle.
import type { ProductType } from "@/lib/company";

/** The start-here group, before the sidebar's own groups. */
export const START = "start";

/** The guide's anchor for a sidebar screen ("/events" -> "nav-events"). */
export const anchorFor = (href: string) =>
  href === START ? "start" : `nav${href.replace(/[^a-z0-9]+/gi, "-")}`.replace(/-+$/, "");

const covers = (href: string, pathname: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

/**
 * The guide link for the screen at `pathname`, in the menu of a company that
 * sells `productTypes` (the guide that company reads): the MOST SPECIFIC
 * sidebar item that covers it (/templates/categories/4/edit -> Categories, not
 * Templates; /tours/packages/new -> Tours, not the tours Dashboard), a
 * sub-screen resolving to its parent (/live-events -> Event Sources, where the
 * guide explains all four). No match -> the top of the guide. Product types
 * not known yet = Mega Events', like the sidebar (visibleGroups).
 */
export function guideLinkFor(
  pathname: string,
  productTypes: readonly ProductType[] = DEFAULT_PRODUCT_TYPES,
): string {
  let best: { top: string; len: number } | null = null;
  for (const group of navFor(productTypes)) {
    for (const item of group.items) {
      for (const href of [item.href, ...(item.items ?? []).map((sub) => sub.href)]) {
        if (covers(href, pathname) && (!best || href.length > best.len)) {
          best = { top: item.href, len: href.length };
        }
      }
    }
  }
  return best ? `/guide#${anchorFor(best.top)}` : "/guide";
}
