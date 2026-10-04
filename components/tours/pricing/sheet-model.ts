/**
 * The departures / pricing sheet's model - pure, shared by the grid
 * (pricing-sheet.tsx), its server actions
 * (lib/actions/tours-pricing-sheet-actions.ts) and
 * scripts/tour-setup-selftest.ts. No I/O, no React. What a cell is and how typed
 * text is read lives in ../sheet/sheet-core.ts, shared with the flights sheet.
 *
 * One row = one sub-tour (a departure of an organized tour). The grid shows the
 * tour as a header row and its sub-tours under it (mega-family
 * docs/plans/TOUR-SETUP-FLOW-PLAN.md, steps 4-6). Three column sets over the same
 * rows (Alon, 04.10.2026 - Departures and Pricing are one table):
 *   departures - what the old board showed: on site, season, status, labels,
 *                bar/bat mitzvah, price, discount, gift, flight, seats, docket;
 *   prices     - the six room prices next to the flight cost;
 *   details    - currency, capacity, itinerary, meeting, ages, notes.
 */
import { CURRENCIES, PRICE_MATRIX_ROWS, SALE_STATUSES, SALE_STATUS_LABELS } from "@/types/tours.types";
import {
  changesOf,
  type SheetColumn as CoreColumn,
  type SheetEdits,
  type SheetOption,
  type SheetRowChange,
  type SheetSaveResult,
  type SheetValue,
} from "@/components/tours/sheet/sheet-core";

export {
  adjustNumber,
  displayText,
  editText,
  isEditable,
  parseCell,
  pasteBlock,
  sameValue,
  type Parsed,
  type SheetKind,
  type SheetOption,
  type SheetRowChange,
  type SheetValue,
} from "@/components/tours/sheet/sheet-core";

// ---------------------------------------------------------------- data
/** The label that marks a date as a bar / bat mitzvah date on the site. */
export const BAR_MITZVAH_LABEL = "מועד בר/בת מצווה";
/** Any wording of it the old sheet used ("בר/בת מצווה", "מועד בר בת מצוה"). */
export const isBarMitzvahLabel = (label: string): boolean => /בר.{0,3}בת.{0,3}מצוו?ה/.test(label);
/** Labels a date shows on the site, next to the bar / bat mitzvah mark. */
export const MAX_DATE_LABELS = 3;

/** The labels a date carries in the database: its own (up to three), then the bar / bat mitzvah mark. */
export const dateLabelsOf = (labels: string[], barMitzvah: boolean): string[] => [
  ...labels.filter((l) => !isBarMitzvahLabel(l)).slice(0, MAX_DATE_LABELS),
  ...(barMitzvah ? [BAR_MITZVAH_LABEL] : []),
];

export interface SheetFlight {
  /** "LY" or "LY+W6". */
  airlines: string;
  /** The status of its blocks, e.g. "Handed to operations". */
  status: string;
  /** A block that holds seats for customers (confirmed / operational / ticketed). */
  live: boolean;
}

export interface SheetRow {
  id: string;
  code: string;
  packageId: string;
  seriesCode: string;
  startDate: string;
  endDate: string;
  /** The season of the tour this date belongs to; null = not assigned yet. */
  seasonId: string | null;
  /** The season's name - or the word an old date still carries without a season row. */
  season: string | null;
  /** The itinerary variant of this date; null = the season's, else the main one. */
  itineraryId: string | null;
  /** "BUD" or "BUD → VIE" (lands in one city, flies home from another). */
  route: string;
  isPublished: boolean;
  saleStatus: string;
  /** What the site shows: the operator's status, or sold out / last places from the seats. */
  siteStatus: string;
  currency: string;
  capacity: number | null;
  seats: { allocated: number; sold: number; remaining: number };
  /** The flight blocks of the date; null = no flight yet (the site says the details will follow). */
  flight: SheetFlight | null;
  /** What the flight costs per seat - for reading the margin, never added to the price. */
  flightCost: { amount: number; currency: string; more: number } | null;
  /** Per person, in PRICE_MATRIX_ROWS order; null = no price for that place. */
  prices: (number | null)[];
  /** Up to three labels of the date; the bar / bat mitzvah mark is apart. */
  labels: string[];
  barMitzvah: boolean;
  /** The red badge on the date card ("חדש באתר"). */
  cardBadge: string | null;
  /** The date's own active discount per traveler. */
  discount: number | null;
  /** The date's own active gift. */
  gift: string | null;
  /** Its other active promotions (the series', a percent, a named one), one line each - edited in the card. */
  morePromotions: string[];
  docket: string | null;
  meetingAt: string | null;
  transfers: boolean;
  childMaxAge: number | null;
  seniorMinAge: number | null;
  seniorDiscount: number | null;
  notes: string | null;
  originFlightId: number | null;
}

export interface SheetTour {
  id: string;
  name: string;
  slug: string;
  codes: string[];
  isActive: boolean;
  /** The seasons of the tour, in order - what a date's Season cell chooses from. */
  seasons: { id: string; name: string }[];
  /** The itinerary variants beside the main one - what a date's Itinerary cell chooses from. */
  itineraries: { id: string; label: string }[];
}

export interface PricingSheetData {
  today: string;
  tours: SheetTour[];
  rows: SheetRow[];
}

export interface SheetSaveOutcome extends SheetSaveResult {
  /** The rows as they are now - for every row the save touched. */
  rows: SheetRow[];
}

// ---------------------------------------------------------------- columns
export type SheetView = "departures" | "prices" | "details";
export const SHEET_VIEWS: readonly SheetView[] = ["departures", "prices", "details"];
export const SHEET_VIEW_LABELS: Record<SheetView, string> = { departures: "Departures", prices: "Prices", details: "Details" };
export type SheetColumn = CoreColumn<SheetView>;

const SALE_STATUS_OPTIONS: SheetOption[] = SALE_STATUSES.map((s) => ({ value: s, label: SALE_STATUS_LABELS[s] }));
const CURRENCY_OPTIONS: SheetOption[] = CURRENCIES.map((c) => ({ value: c, label: c }));

/** The price columns, double room first - the price every card and composition starts from. */
const PRICE_ORDER = [1, 0, 2, 3, 4, 5];
const PRICE_SHORT = ["Single", "Double", "3rd adult", "Child 2", "Child 3", "Child 4"];
export const priceKey = (index: number) => `price${index}`;
export const priceIndexOf = (key: string): number | null => {
  const m = /^price([0-5])$/.exec(key);
  return m ? Number(m[1]) : null;
};

/** The columns of each view, in the order it shows them. */
const VIEW_ORDER: Record<SheetView, string[]> = {
  departures: [
    "isPublished",
    "dates",
    "route",
    "seasonId",
    "saleStatus",
    "labels",
    "barMitzvah",
    "price1",
    "discount",
    "gift",
    "morePromotions",
    "flight",
    "seats",
    "docket",
  ],
  prices: ["dates", "route", "isPublished", "saleStatus", "seats", "flightCost", ...PRICE_ORDER.map(priceKey), "currency"],
  details: [
    "dates",
    "isPublished",
    "saleStatus",
    "currency",
    "capacity",
    "seasonId",
    "itineraryId",
    "cardBadge",
    "meetingAt",
    "transfers",
    "childMaxAge",
    "seniorMinAge",
    "seniorDiscount",
    "notes",
  ],
};

type ColumnDef = Omit<SheetColumn, "views">;
const DEFS: ColumnDef[] = [
  { key: "isPublished", label: "On site", title: "Published on the site", kind: "bool", width: 70 },
  { key: "dates", label: "Dates", kind: "readonly", width: 150 },
  { key: "route", label: "Route", kind: "readonly", width: 90 },
  {
    key: "seasonId",
    label: "Season",
    title: "The season of the tour this date belongs to - its itinerary, description and images",
    kind: "choice",
    nullable: true,
    nullLabel: "No season",
    width: 120,
  },
  {
    key: "saleStatus",
    label: "Status",
    title: "The status you set (the site may show sold out / last places from the seats)",
    kind: "choice",
    options: SALE_STATUS_OPTIONS,
    width: 120,
  },
  {
    key: "labels",
    label: "Labels",
    title: `Up to ${MAX_DATE_LABELS} labels the site shows on the date (comma between them)`,
    kind: "labels",
    maxLabels: MAX_DATE_LABELS,
    width: 190,
  },
  {
    key: "barMitzvah",
    label: "Bar/Bat Mitzvah",
    title: `A bar / bat mitzvah date: the site shows "${BAR_MITZVAH_LABEL}" on it`,
    kind: "bool",
    width: 112,
  },
  { key: "seats", label: "Seats", title: "Sold / allocated flight seats", kind: "readonly", width: 80 },
  { key: "flightCost", label: "Flight cost", title: "Flight cost per seat (for the margin - not added to the price)", kind: "readonly", width: 90 },
  ...PRICE_ORDER.map(
    (i): ColumnDef => ({
      key: priceKey(i),
      label: PRICE_SHORT[i],
      title: `${PRICE_MATRIX_ROWS[i].label} - price per person`,
      kind: "price",
      width: 90,
    }),
  ),
  {
    key: "discount",
    label: "Discount",
    title: "Discount per traveler on this date - the price on the site drops by it",
    kind: "money",
    width: 86,
    min: 1,
    top: 100_000,
  },
  { key: "gift", label: "Gift", title: "A gift of this date, as the site words it", kind: "text", width: 150, max: 200 },
  {
    key: "morePromotions",
    label: "More promotions",
    title: "Other active promotions of the date (the series', a percent, a named discount) - edited in the date's card",
    kind: "readonly",
    width: 160,
  },
  { key: "flight", label: "Flight", title: "The flight block of the date. None yet = the site says the flight details will follow", kind: "readonly", width: 150 },
  { key: "docket", label: "Docket", title: "The accounting number", kind: "text", width: 90, max: 60 },
  { key: "currency", label: "Cur.", title: "Currency", kind: "choice", options: CURRENCY_OPTIONS, width: 64 },
  { key: "capacity", label: "Capacity", kind: "int", width: 84, min: 0, top: 2000 },
  {
    key: "itineraryId",
    label: "Itinerary",
    title: "The day-by-day variant of this date. Empty = the season's variant, else the main itinerary",
    kind: "choice",
    nullable: true,
    nullLabel: "Main / the season's",
    width: 150,
  },
  { key: "cardBadge", label: "Card badge", title: 'The red badge on the date card, e.g. "חדש באתר"', kind: "text", width: 110, max: 60 },
  { key: "meetingAt", label: "Meeting", title: "Team meeting at the airport (Israel time)", kind: "datetime", width: 150 },
  { key: "transfers", label: "Transfers", kind: "bool", width: 84 },
  { key: "childMaxAge", label: "Child to", title: "Child up to age (empty = the series')", kind: "int", width: 76, min: 0, top: 25 },
  { key: "seniorMinAge", label: "Senior from", title: "Senior from age (empty = the series')", kind: "int", width: 90, min: 40, top: 120 },
  { key: "seniorDiscount", label: "Senior disc.", title: "Senior discount per person (empty = the series')", kind: "money", width: 90, min: 0, top: 100000 },
  { key: "notes", label: "Notes", kind: "text", width: 220, max: 4000 },
];

export const SHEET_COLUMNS: SheetColumn[] = DEFS.map((c) => ({
  ...c,
  views: SHEET_VIEWS.filter((v) => VIEW_ORDER[v].includes(c.key)),
}));
export const columnByKey = new Map(SHEET_COLUMNS.map((c) => [c.key, c]));
export const columnsFor = (view: SheetView): SheetColumn[] =>
  VIEW_ORDER[view].map((key) => columnByKey.get(key)).filter((c): c is SheetColumn => !!c);

/** The value of one editable cell of a row (what the grid shows and what `before` carries). */
export function cellValue(row: SheetRow, key: string): SheetValue {
  const i = priceIndexOf(key);
  if (i !== null) return row.prices[i] ?? null;
  switch (key) {
    case "isPublished":
      return row.isPublished;
    case "saleStatus":
      return row.saleStatus;
    case "seasonId":
      return row.seasonId;
    case "itineraryId":
      return row.itineraryId;
    case "currency":
      return row.currency;
    case "capacity":
      return row.capacity;
    case "labels":
      return row.labels;
    case "barMitzvah":
      return row.barMitzvah;
    case "cardBadge":
      return row.cardBadge;
    case "discount":
      return row.discount;
    case "gift":
      return row.gift;
    case "docket":
      return row.docket;
    case "meetingAt":
      return row.meetingAt;
    case "transfers":
      return row.transfers;
    case "childMaxAge":
      return row.childMaxAge;
    case "seniorMinAge":
      return row.seniorMinAge;
    case "seniorDiscount":
      return row.seniorDiscount;
    case "notes":
      return row.notes;
    default:
      return null;
  }
}

/** The editable cell keys a save may carry. */
export const EDITABLE_KEYS = new Set(SHEET_COLUMNS.filter((c) => c.kind !== "readonly").map((c) => c.key));

/** The list of a choice cell that depends on the row's tour (season, itinerary). */
export function rowOptions(tour: SheetTour | undefined, key: string): SheetOption[] | undefined {
  if (key === "seasonId") return (tour?.seasons ?? []).map((s) => ({ value: s.id, label: s.name }));
  if (key === "itineraryId") return (tour?.itineraries ?? []).map((v) => ({ value: v.id, label: v.label }));
  return undefined;
}

/** The changes to send: every edited cell whose value differs from the row as loaded. */
export const rowChanges = (rows: Map<string, SheetRow>, edits: SheetEdits): SheetRowChange[] => changesOf(rows, edits, cellValue);
