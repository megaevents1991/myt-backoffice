import {
  CalendarDays,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  Database,
  DownloadCloud,
  FolderTree,
  Handshake,
  Home,
  Hotel,
  Image as ImageIcon,
  Images,
  LayoutTemplate,
  MapPin,
  Percent,
  Plane,
  Rss,
  ScrollText,
  Tag,
  Tags,
  Ticket,
  TicketCheck,
  Trophy,
  UserCog,
} from "lucide-react";
import { ADMIN_ROLES, type Role } from "@/types/auth.types";

export interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Extra words the command palette matches on (Hebrew label, provider name). */
  keywords?: string;
  /** Nested items render as a sub-menu under this one. */
  items?: NavItem[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
  /** Only these roles see the group. Undefined = every staff role. */
  roles?: Role[];
  /** Groups that start folded - long tails the daily flow rarely needs. */
  defaultCollapsed?: boolean;
}

/**
 * The backoffice IA, following the structure spec v1.0 (6 areas / 16 modules):
 * Dashboard - Reservations - Products - Marketing - Website - Admin.
 *
 * Routes did NOT move; this is purely how they are grouped and labelled. The
 * one addition to the spec is "Event Sources" - the four provider browse
 * screens that feed Events and had no home in the document.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { name: "Dashboard", href: "/dashboard", icon: Home, keywords: "home kpi" },
      {
        name: "Reservations",
        href: "/reservations",
        icon: ClipboardList,
        keywords: "orders bookings הזמנות",
      },
      {
        name: "Tasks",
        href: "/tasks",
        icon: CheckSquare,
        keywords: "todo board work queue משימות",
      },
    ],
  },
  {
    label: "Products",
    items: [
      {
        name: "Events",
        href: "/events",
        icon: CalendarDays,
        keywords: "catalog אירועים",
      },
      {
        name: "Offline Flights",
        href: "/offline-flights",
        icon: Plane,
        keywords: "mega inventory טיסות",
      },
      {
        name: "Offline Hotels",
        href: "/offline-hotels",
        icon: Hotel,
        keywords: "mega inventory מלונות",
      },
      {
        name: "Event Sources",
        href: "/sports-events",
        icon: DownloadCloud,
        keywords: "providers feeds import",
        items: [
          {
            name: "Sports (XS2E)",
            href: "/sports-events",
            icon: Trophy,
            keywords: "xs2event provider",
          },
          {
            name: "Live (LiveTickets)",
            href: "/live-events",
            icon: Ticket,
            keywords: "livetickets provider",
          },
          {
            name: "P1 Tickets",
            href: "/p1-events",
            icon: TicketCheck,
            keywords: "p1 provider xml",
          },
          {
            name: "TixStock",
            href: "/tixstock-events",
            icon: Tags,
            keywords: "tixstock provider",
          },
        ],
      },
    ],
  },
  {
    label: "Marketing",
    items: [
      {
        name: "Creative Generator",
        href: "/creative-generator",
        icon: ImageIcon,
        keywords: "ads creatives",
      },
      {
        name: "Meta Product Feed",
        href: "/meta-feed",
        icon: Rss,
        keywords: "facebook instagram catalog",
      },
      {
        name: "Partners",
        href: "/partners",
        icon: Handshake,
        keywords: "affiliates suppliers שותפים",
      },
      {
        name: "Coupons",
        href: "/coupons",
        icon: Percent,
        keywords: "discounts promo קופונים",
      },
      {
        name: "Forms",
        href: "/forms",
        icon: ClipboardCheck,
        keywords: "leads questionnaires טפסים",
      },
    ],
  },
  {
    label: "Website",
    defaultCollapsed: true,
    items: [
      { name: "Assets", href: "/assets", icon: Images, keywords: "media library" },
      { name: "Storage", href: "/storage", icon: Database, keywords: "files buckets" },
      {
        name: "Locations",
        href: "/locations",
        icon: MapPin,
        keywords: "cities countries יעדים",
      },
      {
        name: "Tags & Rules",
        href: "/event-tags",
        icon: Tag,
        keywords: "tagging auto-tag תגיות",
      },
      {
        name: "Categories",
        href: "/templates/categories",
        icon: FolderTree,
        keywords: "taxonomy קטגוריות",
      },
      {
        name: "Templates",
        href: "/templates",
        icon: LayoutTemplate,
        keywords: "cms artists blog תבניות",
      },
    ],
  },
  {
    label: "Admin",
    roles: ADMIN_ROLES,
    defaultCollapsed: true,
    items: [
      { name: "Users", href: "/users", icon: UserCog, keywords: "roles permissions" },
      {
        name: "Audit Log",
        href: "/audit-log",
        icon: ScrollText,
        keywords: "history changes",
      },
    ],
  },
];

/** Flat list of every navigable item (parents + children), for search. */
export function flattenNav(groups: NavGroup[] = NAV_GROUPS): NavItem[] {
  return groups.flatMap((group) =>
    group.items.flatMap((item) => (item.items ? [item, ...item.items] : [item])),
  );
}

/**
 * Groups this role may see. forms_operator lives entirely inside /forms - the
 * rest of the nav would just be a wall of middleware redirects.
 */
export function visibleGroups(role: Role | undefined | null): NavGroup[] {
  if (role === "forms_operator") {
    return [
      {
        label: "Forms",
        items: NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.href === "/forms"),
      },
    ];
  }
  return NAV_GROUPS.filter(
    (group) => !group.roles || (role && group.roles.includes(role)),
  );
}

/**
 * Only the MOST SPECIFIC matching href is active. A plain prefix test lights up
 * every ancestor too, so on /templates/categories both "Templates" and
 * "Categories" looked selected - which reads as a stuck button.
 */
export function activeHref(
  pathname: string,
  groups: NavGroup[],
): string | undefined {
  return flattenNav(groups)
    .map((item) => item.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
}

/** Route segments that are ids rather than words - shown as-is, not title-cased. */
const ID_LIKE = /^[0-9a-f-]{6,}$|^\d+$/i;

const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  events: "Events",
  reservations: "Reservations",
  coupons: "Coupons",
  partners: "Partners",
  forms: "Forms",
  "offline-flights": "Offline Flights",
  "offline-hotels": "Offline Hotels",
  "sports-events": "Sports Events",
  "live-events": "Live Events",
  "p1-events": "P1 Events",
  "tixstock-events": "TixStock Events",
  "creative-generator": "Creative Generator",
  "meta-feed": "Meta Product Feed",
  "event-tags": "Tags & Rules",
  templates: "Templates",
  categories: "Categories",
  artists: "Artists",
  football: "Football Teams",
  blog: "Blog",
  assets: "Assets",
  storage: "Storage",
  locations: "Locations",
  users: "Users",
  "audit-log": "Audit Log",
  new: "New",
  edit: "Edit",
  view: "View",
  invites: "Invites",
  responses: "Responses",
  report: "Report",
  order: "Order",
  series: "Series",
};

export interface Crumb {
  label: string;
  href: string;
  isId: boolean;
}

/** Breadcrumb trail for a pathname, e.g. /templates/categories/42/edit. */
export function breadcrumbsFor(pathname: string): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  return segments.map((segment, index) => {
    const isId = ID_LIKE.test(segment);
    return {
      label: isId ? `#${segment.slice(0, 8)}` : (SEGMENT_LABELS[segment] ?? segment),
      href: `/${segments.slice(0, index + 1).join("/")}`,
      isId,
    };
  });
}
