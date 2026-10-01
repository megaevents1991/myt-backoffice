import {
  AlertTriangle,
  BarChart3,
  Bot,
  CalendarDays,
  CalendarHeart,
  CalendarRange,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  Coins,
  Database,
  DownloadCloud,
  FileSignature,
  FileText,
  FolderTree,
  Gauge,
  Handshake,
  Home,
  Hotel,
  Image as ImageIcon,
  Images,
  Inbox,
  Layers,
  LayoutDashboard,
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

/**
 * The backoffice IA, following the structure spec v1.0 (6 areas / 16 modules):
 * Dashboard - Reservations - Products - Marketing - Website - Admin.
 *
 * Routes did NOT move; this is purely how they are grouped and labelled. The
 * one addition to the spec is "Event Sources" - the four provider browse
 * screens that feed Events and had no home in the document.
 *
 * This list is the Mega Events navigation and also what the guide follows
 * (guide-model.ts, guide-link.ts), so the tours screens are NOT in it - they
 * live in TOURS_NAV_GROUP below. `productType: "events"` marks what a company
 * that does not sell events must not see; untagged entries are shared.
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
        // Task rules is a tab on this page now (/tasks?tab=rules), not its own item.
        keywords: "todo board work queue roadmap task rules recurring משימות כללים",
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
      },
    ],
  },
  {
    label: "Website",
    defaultCollapsed: true,
    productType: "events",
    items: [
      {
        name: "Homepage",
        href: "/homepage",
        icon: Home,
        keywords: "homepage layout sections carousel hero order עמוד הבית סדר",
      },
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
        keywords: "help manual docs מדריך הדרכה",
      },
      {
        name: "Users",
        href: "/users",
        icon: UserCog,
        keywords: "roles permissions",
        roles: ADMIN_ROLES,
      },
      {
        name: "Audit Log",
        href: "/audit-log",
        icon: ScrollText,
        keywords: "history changes",
        roles: ADMIN_ROLES,
      },
    ],
  },
];

/** Where the "tours" product type lands (the Tours overview). */
export const TOURS_HOME = "/tours";

/**
 * The screens of the "tours" product type (Mega Family). Hebrew names - the
 * operators work in Hebrew - with English and Hebrew keywords for the palette.
 * Shown only in a company that sells tours; see visibleGroups().
 */
export const TOURS_NAV_GROUP: NavGroup = {
  label: "Tours",
  productType: "tours",
  items: [
    {
      name: "סקירה",
      href: TOURS_HOME,
      icon: LayoutDashboard,
      keywords: "tours overview home summary סקירה טיולים ראשי",
    },
    {
      // What waits for a person: approvals only a manager gives, and data the
      // import could not settle on its own. Company admins and superadmins.
      name: "אישורים וטיפול",
      href: "/tours/approvals",
      icon: ClipboardCheck,
      keywords: "approvals review human decisions pending אישורים אישור טיפול ממתין מנהל",
      roles: ADMIN_ROLES,
    },
    {
      name: "לוח יציאות",
      href: "/tours/departures",
      icon: CalendarRange,
      keywords: "departures board dates trips prices יציאות תאריכים מחירים",
    },
    {
      name: "סדרות",
      href: "/tours/series",
      icon: Layers,
      keywords: "series routes weekly סדרות סדרה מסלולים",
    },
    {
      name: "חוזי טיסה",
      href: "/tours/contracts",
      icon: FileSignature,
      keywords: "flight contracts airlines rules חוזים חוזה חברות תעופה",
    },
    {
      name: "לוח חגים",
      href: "/tours/calendar",
      icon: CalendarHeart,
      keywords: "calendar holidays periods school breaks חגים חופשות מועדים",
    },
    {
      name: "שער יומי",
      href: "/tours/rates",
      icon: Coins,
      keywords: "exchange rates daily rate currency שער מטבע דולר אירו",
    },
    {
      name: "דוחות",
      href: "/tours/reports",
      icon: BarChart3,
      keywords: "reports realization statistics דוחות דוח מימוש",
    },
    {
      name: "בעיות נתונים",
      href: "/tours/exceptions",
      icon: AlertTriangle,
      keywords: "exceptions data problems issues warnings בעיות חריגות נתונים",
    },
    {
      name: "עמודי טיולים",
      href: "/tours/packages",
      icon: MapIcon,
      keywords: "packages tour pages trips site content חבילות טיולים עמודים",
    },
    {
      name: "קטגוריות ותגיות",
      href: "/tours/terms",
      icon: Tags,
      keywords: "terms categories tags taxonomy קטגוריות תגיות",
    },
    {
      name: "מלווי קבוצות",
      href: "/tours/instructors",
      icon: Users,
      keywords: "instructors guides tour leaders escorts מלווים מדריכים",
    },
    {
      name: "מלונות",
      href: "/tours/hotels",
      icon: Hotel,
      keywords: "hotels accommodation מלונות מלון",
    },
    {
      name: "עמודי תוכן",
      href: "/tours/pages",
      icon: FileText,
      keywords: "content pages cms about terms עמודים תוכן",
    },
    {
      name: "לידים",
      href: "/tours/leads",
      icon: Inbox,
      keywords: "leads contact inquiries newsletter לידים פניות צור קשר",
    },
    {
      name: "הגדרות חברה",
      href: "/tours/settings",
      icon: Settings,
      keywords: "company settings brand contact הגדרות חברה",
    },
  ],
};

/**
 * What the nav assumes until the company context has loaded, and for every
 * user who belongs to one company: Mega Events.
 */
export const DEFAULT_PRODUCT_TYPES: readonly ProductType[] = ["events"];

const FLIGHTS_HREF = "/offline-flights";
const TASKS_HREF = "/tasks";
const SERIES_HREF = "/tours/series";

/** Every group of every product type, in sidebar order: Tours sits right after Products. */
const ALL_NAV_GROUPS: NavGroup[] = NAV_GROUPS.flatMap((group) =>
  group.label === "Products" ? [group, TOURS_NAV_GROUP] : [group],
);

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
 * A company that sells tours and no events sees the Tours group and nothing
 * else. Every other screen of the backoffice is a Mega Events feature with no
 * company column behind it (reservations, users, the audit log, ...), and the
 * auth guards refuse them to a member of a tours company anyway
 * (worksInMegaEvents in lib/auth/guards.ts) - the nav must not offer what the
 * server will refuse. Someone who works in both companies switches company.
 *
 * Two screens are shared, because their data carries a company column and is
 * scoped by the active company. They move into the Tours group under the names
 * its operators use: the flights list right after the series, and the task
 * board right after the overview.
 */
function asToursCompany(groups: NavGroup[]): NavGroup[] {
  const shared = flattenNav(groups);
  const flights = shared.find((item) => item.href === FLIGHTS_HREF);
  const tasks = shared.find((item) => item.href === TASKS_HREF);
  const insertAfter = (items: NavItem[], anchorHref: string, item: NavItem): NavItem[] => {
    const anchor = items.findIndex((entry) => entry.href === anchorHref);
    const at = anchor === -1 ? items.length : anchor + 1;
    return [...items.slice(0, at), item, ...items.slice(at)];
  };
  return groups
    .filter((group) => group.productType === "tours")
    .map((group) => {
      let items = group.items;
      if (flights) {
        items = insertAfter(items, SERIES_HREF, {
          ...flights,
          name: "קבוצות טיסה",
          keywords: "offline flights flight blocks groups seats allotment טיסות קבוצות בלוקים מושבים",
        });
      }
      if (tasks) {
        items = insertAfter(items, TOURS_HOME, {
          ...tasks,
          name: "משימות",
          keywords: "tasks todo board work queue משימות לוח מטלות",
        });
      }
      return { ...group, items };
    });
}

/**
 * The screens a company that sells tours and no events works in: its own
 * module, the company-scoped flights list and the company-scoped task board.
 * The dashboard layout sends such a company home (TOURS_HOME) from anywhere else.
 */
export function isToursCompanyPath(pathname: string): boolean {
  return [TOURS_HOME, FLIGHTS_HREF, TASKS_HREF].some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );
}

/**
 * Groups this role may see in a company that sells `productTypes`.
 * forms_operator lives entirely inside /forms - the rest of the nav would just
 * be a wall of middleware redirects. tours_agent likewise: only the screens
 * middleware lets it open (lib/auth/tours-agent.ts), whatever the company.
 *
 * An entry tagged with a product type the company does not sell is hidden.
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
    return [
      {
        ...TOURS_NAV_GROUP,
        items: TOURS_NAV_GROUP.items.filter((item) => !item.roles && isToursAgentPath(item.href)),
      },
    ];
  }

  const sellsEvents = productTypes.includes("events");
  const sellsTours = productTypes.includes("tours");
  // Mega Events (and anything unresolved): the nav exactly as it was before companies.
  if (sellsEvents && !sellsTours) return groupsForRole(NAV_GROUPS, role);

  const sells = (entry: { productType?: ProductType }) =>
    !entry.productType || productTypes.includes(entry.productType);
  const groups = groupsForRole(ALL_NAV_GROUPS, role)
    .filter(sells)
    .map((group) => ({
      ...group,
      items: group.items
        .filter(sells)
        .map((item) => (item.items ? { ...item, items: item.items.filter(sells) } : item)),
    }));

  // A group left with nothing (Products in a tours company) is not drawn.
  const toursOnly = sellsTours && !sellsEvents;
  return (toursOnly ? asToursCompany(groups) : groups).filter(
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
 * The tours screens are Hebrew, so their trail is too. Applied only under
 * /tours - "series" and the like keep their English label everywhere else.
 */
const TOURS_SEGMENT_LABELS: Record<string, string> = {
  tours: "טיולים",
  departures: "לוח יציאות",
  series: "סדרות",
  contracts: "חוזי טיסה",
  calendar: "לוח חגים",
  rates: "שער יומי",
  reports: "דוחות",
  exceptions: "בעיות נתונים",
  packages: "עמודי טיולים",
  terms: "קטגוריות ותגיות",
  instructors: "מלווי קבוצות",
  hotels: "מלונות",
  pages: "עמודי תוכן",
  leads: "לידים",
  settings: "הגדרות חברה",
  approvals: "אישורים וטיפול",
  flights: "קבוצות טיסה",
  new: "חדש",
  edit: "עריכה",
};

export interface Crumb {
  label: string;
  href: string;
  isId: boolean;
}

/** Breadcrumb trail for a pathname, e.g. /templates/categories/42/edit. */
export function breadcrumbsFor(pathname: string): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  const labels =
    segments[0] === "tours" ? { ...SEGMENT_LABELS, ...TOURS_SEGMENT_LABELS } : SEGMENT_LABELS;
  return segments.map((segment, index) => {
    const isId = ID_LIKE.test(segment);
    return {
      label: isId ? `#${segment.slice(0, 8)}` : (labels[segment] ?? segment),
      href: `/${segments.slice(0, index + 1).join("/")}`,
      isId,
    };
  });
}
