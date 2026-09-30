// Pure shaping of the guide: sections grouped exactly like the sidebar
// (lib/nav.ts is the ONE source - a screen added to the menu shows up here
// with its guide sections, and scripts/guide-selftest.ts fails while it has
// none), inline links, and the text a search reads. No React, no DB.

import { NAV_GROUPS, type NavItem } from "@/lib/nav";
import { anchorFor, START } from "@/lib/guide-link";
import { ADMIN_ROLES, type Role } from "@/types/auth.types";
import type { GuideSection, L } from "./guide-content";

// Anchors live beside the top bar's "Guide" button (lib/guide-link.ts).
export { anchorFor, START };

/** Screens that need no guide section of their own (this page). */
export const NO_SECTION_NEEDED = new Set(["/guide"]);

const l = (en: string, he: string): L => ({ en, he });

/** Hebrew next to the sidebar's English labels (the sidebar itself stays English). */
export const GROUP_LABELS: Record<string, L> = {
  [START]: l("Start here", "מתחילים כאן"),
  Overview: l("Overview", "סקירה"),
  Products: l("Products", "מוצרים"),
  Marketing: l("Marketing", "שיווק"),
  Website: l("Website", "אתר"),
  AI: l("AI", "AI"),
  Admin: l("Admin", "ניהול"),
};

export const NAV_LABELS: Record<string, L> = {
  "/dashboard": l("Dashboard", "דשבורד"),
  "/reservations": l("Reservations", "הזמנות"),
  "/tasks": l("Tasks", "משימות"),
  "/events": l("Events", "אירועים"),
  "/factory": l("Events Factory", "מפעל האירועים"),
  "/price-changes": l("Price Changes", "שינויי מחיר"),
  "/price-light": l("Price Light", "רמזור מחירים"),
  "/offline-flights": l("Offline Flights", "טיסות אופליין"),
  "/offline-hotels": l("Offline Hotels", "מלונות אופליין"),
  "/sports-events": l("Event Sources", "מקורות אירועים"),
  "/live-events": l("Live (LiveTickets)", "Live (LiveTickets)"),
  "/p1-events": l("P1 Tickets", "P1 Tickets"),
  "/tixstock-events": l("TixStock", "TixStock"),
  "/creative-generator": l("Creative Generator", "מחולל קריאייטיב"),
  "/meta-feed": l("Meta Product Feed", "פיד המוצרים למטא"),
  "/partners": l("Partners", "שותפים"),
  "/coupons": l("Coupons", "קופונים"),
  "/forms": l("Forms", "טפסים"),
  "/homepage": l("Homepage", "עמוד הבית"),
  "/assets": l("Assets", "Assets - סמלים"),
  "/storage": l("Storage", "Storage - קבצים"),
  "/locations": l("Locations", "מיקומים"),
  "/event-tags": l("Tags & Rules", "תגיות וחוקים"),
  "/templates/categories": l("Categories", "קטגוריות"),
  "/templates": l("Templates", "תבניות"),
  "/ai-factory": l("AI Factory", "AI Factory"),
  "/guide": l("Guide", "מדריך"),
  "/users": l("Users", "משתמשים"),
  "/audit-log": l("Audit Log", "לוג ביקורת"),
};

/** A sub-screen whose href equals its parent's gets its own chip label. */
const SUB_LABELS: Record<string, L> = {
  "/sports-events": l("Sports (XS2E)", "ספורט (XS2E)"),
};

export type GuideItem = {
  href: string;
  anchor: string;
  label: L;
  icon: NavItem["icon"] | null;
  adminOnly: boolean;
  /** Sub-screens (Event Sources' four providers), each opened in a new tab. */
  subs: { href: string; label: L }[];
  sections: GuideSection[];
};

export type GuideGroup = { key: string; label: L; items: GuideItem[] };

/**
 * The sidebar, with each screen carrying the guide sections written for it.
 * A section whose `nav` is not in the menu is dropped (the selftest catches
 * that); a screen with no section is kept only with `keepEmpty` (the selftest
 * uses it to find the holes).
 */
export function buildGuide(sections: GuideSection[], keepEmpty = false): GuideGroup[] {
  const byNav = new Map<string, GuideSection[]>();
  for (const s of sections) byNav.set(s.nav, [...(byNav.get(s.nav) ?? []), s]);

  const start: GuideGroup = {
    key: START,
    label: GROUP_LABELS[START],
    items: [
      {
        href: START,
        anchor: anchorFor(START),
        label: GROUP_LABELS[START],
        icon: null,
        adminOnly: false,
        subs: [],
        sections: byNav.get(START) ?? [],
      },
    ],
  };

  const groups: GuideGroup[] = NAV_GROUPS.map((group) => ({
    key: group.label,
    label: GROUP_LABELS[group.label] ?? l(group.label, group.label),
    items: group.items.map((item) => ({
      href: item.href,
      anchor: anchorFor(item.href),
      label: NAV_LABELS[item.href] ?? l(item.name, item.name),
      icon: item.icon,
      adminOnly: adminOnly(group.roles ?? item.roles),
      subs: (item.items ?? []).map((sub) => ({
        href: sub.href,
        label: SUB_LABELS[sub.href] ?? NAV_LABELS[sub.href] ?? l(sub.name, sub.name),
      })),
      sections: byNav.get(item.href) ?? [],
    })),
  }));

  return [start, ...groups]
    .map((g) => ({ ...g, items: g.items.filter((i) => keepEmpty || i.sections.length > 0) }))
    .filter((g) => g.items.length > 0);
}

function adminOnly(roles: Role[] | undefined): boolean {
  return !!roles && roles.length > 0 && roles.every((r) => ADMIN_ROLES.includes(r));
}

/** A piece of guide text: plain, or a link that opens in a new tab. */
export type Inline = { text: string; href?: string };

const LINK = /\[([^\]\n]+)\]\(((?:\/|https:\/\/)[^)\s]*)\)/g;

/** "Open [Events](/events) and…" -> text / link / text. Only "/…" and https links. */
export function parseInline(value: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of value.matchAll(LINK)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: value.slice(last, at) });
    out.push({ text: m[1], href: m[2] });
    last = at + m[0].length;
  }
  if (last < value.length) out.push({ text: value.slice(last) });
  return out;
}

/** Both languages of everything a section says. */
export function allTexts(section: GuideSection): L[] {
  const flow = section.flow
    ? [section.flow.title, ...section.flow.steps.flatMap((s) => (s.sub ? [s.label, s.sub] : [s.label]))]
    : [];
  return [
    section.title,
    section.intro,
    ...(section.howTo ?? []).flatMap((h) => [h.title, ...h.steps]),
    ...(section.points ?? []),
    ...(section.rules ?? []),
    ...flow,
    ...(section.links ?? []).map((k) => k.label),
  ];
}

/** Every link a section carries - its buttons and the ones inside its text. */
export function sectionHrefs(section: GuideSection): string[] {
  const inline = allTexts(section)
    .flatMap((v) => [v.en, v.he])
    .flatMap((v) => parseInline(v).flatMap((p) => (p.href ? [p.href] : [])));
  return [...(section.links ?? []).map((k) => k.href), ...inline];
}

/** What a search reads: both languages (a Hebrew step often quotes an English button). */
export function searchText(section: GuideSection): string {
  return allTexts(section)
    .flatMap((v) => [v.en, v.he])
    .join(" ")
    .replace(LINK, "$1");
}
