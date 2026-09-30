// Where in /guide a screen is explained. Pure - shared by the top bar's
// "Guide" button (every screen) and the guide itself (its anchors), so the
// two can never disagree. scripts/guide-selftest.ts checks every menu screen.

import { NAV_GROUPS } from "@/lib/nav";

/** The start-here group, before the sidebar's own groups. */
export const START = "start";

/** The guide's anchor for a sidebar screen ("/events" -> "nav-events"). */
export const anchorFor = (href: string) =>
  href === START ? "start" : `nav${href.replace(/[^a-z0-9]+/gi, "-")}`.replace(/-+$/, "");

const covers = (href: string, pathname: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

/**
 * The guide link for the screen at `pathname`: the MOST SPECIFIC sidebar item
 * that covers it (/templates/categories/4/edit -> Categories, not Templates),
 * a sub-screen resolving to its parent (/live-events -> Event Sources, where
 * the guide explains all four). No match -> the top of the guide.
 */
export function guideLinkFor(pathname: string): string {
  let best: { top: string; len: number } | null = null;
  for (const group of NAV_GROUPS) {
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
