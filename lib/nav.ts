import {
  BadgeCheck,
  Bot,
  CalendarDays,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  Database,
  DownloadCloud,
  FileText,
  FolderTree,
  Gauge,
  Handshake,
  Home,
  Hotel,
  Image as ImageIcon,
  Images,
  CreditCard,
  Inbox,
  LayoutTemplate,
  Map as MapIcon,
  MapPin,
  Percent,
  Plane,
  Rss,
  ScrollText,
  Settings,
  Tag,
  Tags,
  Ticket,
  TicketCheck,
  Trophy,
  UserCog,
  Users,
  TrendingUp,
  Factory,
  BookOpen,
  Table2,
} from "lucide-react";
import { ADMIN_ROLES, TOURS_AGENT_ROLE, type Role } from "@/types/auth.types";
import { isToursAgentPath } from "@/lib/auth/tours-agent";
// Type only - lib/company.ts is server code and must not reach the client bundle.
import type { ProductType } from "@/lib/company";

export interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Extra words the command palette matches on (Hebrew label, provider name). */
  keywords?: string;
  /** Nested items render as a sub-menu under this one. */
  items?: NavItem[];
  /** Restrict a single item to these roles (group-level `roles` still applies). */
  roles?: Role[];
  /** Shown only in a company that sells this product type. Undefined = shared by every company. */
  productType?: ProductType;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
  /** Only these roles see the group. Undefined = every staff role. */
  roles?: Role[];
  /** Groups that start folded - long tails the daily flow rarely needs. */
  defaultCollapsed?: boolean;
  /** The whole group belongs to one product type. Undefined = shared (its items may still be tagged). */
  productType?: ProductType;
}

/** Where the "tours" product type lands: its dashboard. */
export const TOURS_HOME = "/tours";

/**
 * The backoffice IA, following the structure spec v1.0 (6 areas / 16 modules):
 * Dashboard - Reservations - Products - Marketing - Website - Admin.
 *
 * Routes did NOT move; this is purely how they are grouped and labelled. The
 * one addition to the spec is "Event Sources" - the four provider browse
 * screens that feed Events and had no home in the document.
 *
 * One menu for every company. Each company sees the same groups in the same
 * order; `productType` marks an entry that belongs to one product type
 * (Events for Mega Events, Tours for a tours company), untagged entries are
 * shared. A tours company gets its own Dashboard, Reservations and Tours in the
 * places where Mega Events has its own. Tours screens that are not part of the
 * daily flow yet (series, flight contracts, holidays, daily rates, reports,
 * data problems) are left out of the menu; their pages still open from links.
 */
const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { name: "Dashboard", href: "/dashboard", icon: Home, keywords: "home kpi", productType: "events" },
      {
        name: "Dashboard",
        href: TOURS_HOME,
        icon: Home,
        keywords: "home kpi overview סקירה ראשי",
        productType: "tours",
      },
      {
        name: "Reservations",
        href: "/reservations",
        icon: ClipboardList,
        keywords: "orders bookings הזמנות",
        productType: "events",
      },
      {
        name: "Reservations",
        href: "/tours/reservations",
        icon: ClipboardList,
        keywords: "orders bookings sales docket הזמנות מכירות נוסעים",
        productType: "tours",
      },
      {
        name: "Online Bookings",
        href: "/tours/bookings",
        icon: CreditCard,
        keywords: "online bookings orders payments card creditguard requests הזמנות אונליין תשלום אשראי בקשות",
        productType: "tours",
      },
      {
        name: "Leads",
        href: "/tours/leads",
        icon: Inbox,
        keywords: "leads contact inquiries newsletter לידים פניות צור קשר",
        productType: "tours",
      },
      {
        name: "Tasks",
        href: "/tasks",
        icon: CheckSquare,
        // Task rules is a tab on this page now (/tasks?tab=rules), not its own item.
        keywords: "todo board work queue roadmap task rules recurring משימות כללים",
      },
      {
        // What waits for a manager: approvals only a manager gives, and data
        // the import could not settle on its own.
        name: "Approvals",
        href: "/tours/approvals",
        icon: BadgeCheck,
        keywords: "approvals review human decisions pending אישורים אישור טיפול ממתין מנהל",
        roles: ADMIN_ROLES,
        productType: "tours",
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
        productType: "events",
      },
      {
        // The tours list - the tours side of Events: each tour opens its page
        // (details, content, dates, prices, flights, hotels); Add Tour is there.
        name: "Tours",
        href: "/tours/packages",
        icon: MapIcon,
        keywords: "tours trips packages tour pages add tour new tour itinerary טיולים טיול חדש עמודי טיולים מסלול",
        productType: "tours",
      },
      {
        // The departures board: every date of every tour, grouped by series.
        name: "Departures",
        href: "/tours/departures",
        icon: CalendarDays,
        keywords: "departures dates prices series board יציאות תאריכים מחירים סדרות לוח",
        productType: "tours",
      },
      {
        // Every sub-tour of the organized tours as one sheet, tour by tour:
        // prices and details edited in bulk, saved with one button.
        name: "Pricing",
        href: "/tours/pricing",
        icon: Table2,
        keywords: "pricing prices sheet bulk edit sub-tours תמחור מחירים טבלה עריכה מרובה תתי טיול",
        productType: "tours",
      },
      {
        name: "Events Factory",
        href: "/factory",
        icon: Factory,
        productType: "events",
        keywords: "drafts batch \u05de\u05e4\u05e2\u05dc \u05d8\u05d9\u05d5\u05d8\u05d5\u05ea",
        roles: ADMIN_ROLES,
      },
      {
        name: "Price Changes",
        href: "/price-changes",
        icon: TrendingUp,
        keywords: "base price sync מחירים סנכרון",
        roles: ADMIN_ROLES,
        productType: "events",
      },
      {
        name: "Price Light",
        href: "/price-light",
        icon: Gauge,
        keywords: "רמזור מתחרים competitor",
        roles: ADMIN_ROLES,
        productType: "events",
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
        productType: "events",
      },
      {
        name: "Event Sources",
        href: "/sports-events",
        icon: DownloadCloud,
        keywords: "providers feeds import",
        productType: "events",
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
        productType: "events",
      },
      {
        name: "Meta Product Feed",
        href: "/meta-feed",
        icon: Rss,
        keywords: "facebook instagram catalog",
        productType: "events",
      },
      {
        name: "Partners",
        href: "/partners",
        icon: Handshake,
        keywords: "affiliates suppliers שותפים",
        productType: "events",
      },
      {
        name: "Coupons",
        href: "/coupons",
        icon: Percent,
        keywords: "discounts promo קופונים",
        productType: "events",
      },
      {
        name: "Forms",
        href: "/forms",
        icon: ClipboardCheck,
        keywords: "leads questionnaires טפסים",
        productType: "events",
      },
    ],
  },
  {
    label: "Website",
    defaultCollapsed: true,
    items: [
      {
        name: "Homepage",
        href: "/homepage",
        icon: Home,
        keywords: "homepage layout sections carousel hero order עמוד הבית סדר",
        productType: "events",
      },
      { name: "Assets", href: "/assets", icon: Images, keywords: "media library", productType: "events" },
      { name: "Storage", href: "/storage", icon: Database, keywords: "files buckets", productType: "events" },
      {
        name: "Locations",
        href: "/locations",
        icon: MapPin,
        keywords: "cities countries יעדים",
        productType: "events",
      },
      {
        name: "Tags & Rules",
        href: "/event-tags",
        icon: Tag,
        keywords: "tagging auto-tag תגיות",
        productType: "events",
      },
      {
        name: "Categories",
        href: "/templates/categories",
        icon: FolderTree,
        keywords: "taxonomy קטגוריות",
        productType: "events",
      },
      {
        name: "Templates",
        href: "/templates",
        icon: LayoutTemplate,
        keywords: "cms artists blog תבניות",
        productType: "events",
      },
      {
        name: "Content Pages",
        href: "/tours/pages",
        icon: FileText,
        keywords: "content pages cms about terms faq blog עמודים תוכן",
        productType: "tours",
      },
      {
        name: "Categories & Tags",
        href: "/tours/terms",
        icon: FolderTree,
        keywords: "terms categories tags taxonomy קטגוריות תגיות",
        productType: "tours",
      },
      {
        name: "Hotels",
        href: "/tours/hotels",
        icon: Hotel,
        keywords: "hotels accommodation מלונות מלון",
        productType: "tours",
      },
      {
        name: "Group Leaders",
        href: "/tours/instructors",
        icon: Users,
        keywords: "instructors guides tour leaders escorts מלווים מדריכים",
        productType: "tours",
      },
    ],
  },
  {
    label: "AI",
    defaultCollapsed: true,
    roles: ADMIN_ROLES,
    productType: "events",
    items: [
      {
        name: "AI Factory",
        href: "/ai-factory",
        icon: Bot,
        keywords: "ai agent agents factory סוכן בינה",
        roles: ADMIN_ROLES,
      },
    ],
  },
  {
    label: "Admin",
    defaultCollapsed: true,
    // Group visible to all staff so the Guide is reachable; the management
    // screens themselves stay admin-only via per-item roles.
    items: [
      {
        name: "Guide",
        href: "/guide",
        icon: BookOpen,
        // Shared: each company reads the guide of its own screens (app/(dashboard)/guide).
        keywords: "help manual docs how to מדריך הדרכה איך",
      },
      {
        // Shared: in a tours company the same screen manages that company's people.
        name: "Users",
        href: "/users",
        icon: UserCog,
        keywords: "roles permissions people members team משתמשים צוות הרשאות",
        roles: ADMIN_ROLES,
      },
      {
        name: "Audit Log",
        href: "/audit-log",
        icon: ScrollText,
        keywords: "history changes",
        roles: ADMIN_ROLES,
        productType: "events",
      },
      {
        // Brand, contact details, the site connection and the company members.
        name: "Settings",
        href: "/tours/settings",
        icon: Settings,
        keywords: "company settings brand contact site connection הגדרות חברה אתר",
        roles: ADMIN_ROLES,
        productType: "tours",
      },
    ],
  },
];

/**
 * What the nav assumes until the company context has loaded, and for every
 * user who belongs to one company: Mega Events.
 */
export const DEFAULT_PRODUCT_TYPES: readonly ProductType[] = ["events"];

const FLIGHTS_HREF = "/offline-flights";
const TASKS_HREF = "/tasks";
const USERS_HREF = "/users";
const GUIDE_HREF = "/guide";

/**
 * The menu of a company that sells `productTypes`: entries of another product
 * type are dropped, and a group left with nothing is not drawn.
 */
function forProducts(groups: NavGroup[], productTypes: readonly ProductType[]): NavGroup[] {
  const sells = (entry: { productType?: ProductType }) =>
    !entry.productType || productTypes.includes(entry.productType);
  return groups
    .filter(sells)
    .map((group) => ({
      ...group,
      items: group.items
        .filter(sells)
        .map((item) => (item.items ? { ...item, items: item.items.filter(sells) } : item)),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * The Mega Events navigation, before any role filter. The guide follows it
 * (guide-model.ts, guide-link.ts), so it holds no tours screens.
 */
export const NAV_GROUPS: NavGroup[] = forProducts(NAV, DEFAULT_PRODUCT_TYPES);

/** The menu of a company that sells `productTypes` (Mega Events' when unknown), before any role filter - the guide of that company follows it. */
export const navFor = (productTypes: readonly ProductType[] = DEFAULT_PRODUCT_TYPES): NavGroup[] =>
  forProducts(NAV, productTypes);

/** Flat list of every navigable item (parents + children), for search. */
export function flattenNav(groups: NavGroup[] = NAV_GROUPS): NavItem[] {
  return groups.flatMap((group) =>
    group.items.flatMap((item) => (item.items ? [item, ...item.items] : [item])),
  );
}

/** The role filter - exactly what visibleGroups() was before companies existed. */
function groupsForRole(groups: NavGroup[], role: Role | undefined | null): NavGroup[] {
  return groups.filter(
    (group) => !group.roles || (role && group.roles.includes(role)),
  ).map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !item.roles || (role && item.roles.includes(role)),
    ),
  }));
}

/**
 * The screens a company that sells tours and no events works in: its own
 * module and the shared screens that follow the active company (flights,
 * tasks, users, the guide).
 * The dashboard layout sends such a company home (TOURS_HOME) from anywhere else.
 */
export function isToursCompanyPath(pathname: string): boolean {
  return [TOURS_HOME, FLIGHTS_HREF, TASKS_HREF, USERS_HREF, GUIDE_HREF].some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );
}

/**
 * Groups this role may see in a company that sells `productTypes`.
 * forms_operator lives entirely inside /forms - the rest of the nav would just
 * be a wall of middleware redirects. tours_agent likewise: only the screens
 * middleware lets it open (lib/auth/tours-agent.ts), whatever the company.
 *
 * Pure - the sidebar and the command palette both call it with the active
 * company's product types, so they can never disagree.
 */
export function visibleGroups(
  role: Role | undefined | null,
  productTypes: readonly ProductType[] = DEFAULT_PRODUCT_TYPES,
): NavGroup[] {
  if (role === "forms_operator") {
    return [
      {
        label: "Forms",
        items: NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.href === "/forms"),
      },
    ];
  }

  if (role === TOURS_AGENT_ROLE) {
    return forProducts(NAV, ["tours"])
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => !item.roles && isToursAgentPath(item.href)),
      }))
      .filter((group) => group.items.length > 0);
  }

  return groupsForRole(forProducts(NAV, productTypes), role).filter(
    (group) => group.items.length > 0,
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
  tasks: "Tasks",
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
  "price-changes": "Price Changes",
  "price-light": "Price Light",
  "ai-factory": "AI Factory",
  factory: "Events Factory",
  guide: "Guide",
  "event-tags": "Tags & Rules",
  homepage: "Homepage",
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

/**
 * The tours screens under /tours, named as the menu names them. /tours itself
 * is the tours dashboard; below it the trail starts at the screen, so
 * /tours/packages reads "Tours", not "Dashboard / Tours".
 */
const TOURS_SEGMENT_LABELS: Record<string, string> = {
  tours: "Dashboard",
  departures: "Departures",
  pricing: "Pricing",
  bookings: "Online Bookings",
  reservations: "Reservations",
  series: "Series",
  contracts: "Flight Contracts",
  calendar: "Holidays",
  rates: "Daily Rates",
  reports: "Reports",
  exceptions: "Data Problems",
  packages: "Tours",
  terms: "Categories & Tags",
  instructors: "Group Leaders",
  hotels: "Hotels",
  pages: "Content Pages",
  leads: "Leads",
  settings: "Settings",
  approvals: "Approvals",
  flights: "Offline Flights",
};

export interface Crumb {
  label: string;
  href: string;
  isId: boolean;
}

/** Breadcrumb trail for a pathname, e.g. /templates/categories/42/edit. */
export function breadcrumbsFor(pathname: string): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  const underTours = segments[0] === "tours";
  const labels = underTours ? { ...SEGMENT_LABELS, ...TOURS_SEGMENT_LABELS } : SEGMENT_LABELS;
  const crumbs = segments.map((segment, index) => {
    const isId = ID_LIKE.test(segment);
    return {
      label: isId ? `#${segment.slice(0, 8)}` : (labels[segment] ?? segment),
      href: `/${segments.slice(0, index + 1).join("/")}`,
      isId,
    };
  });
  return underTours && crumbs.length > 1 ? crumbs.slice(1) : crumbs;
}
