/**
 * The Pricing sheet's model - pure, shared by the grid (pricing-sheet.tsx), its
 * server actions (lib/actions/tours-pricing-sheet-actions.ts) and
 * scripts/tour-setup-selftest.ts. No I/O, no React.
 *
 * One row = one sub-tour (a departure of an organized tour). The grid shows the
 * tour as a header row and its sub-tours under it (mega-family
 * docs/plans/TOUR-SETUP-FLOW-PLAN.md, steps 4-6). An edit is kept as the new
 * value of a cell; Save sends, per row, every changed cell with the value the
 * sheet showed before (`before`), so the server can skip a row someone else
 * changed in the meantime.
 */
import { CURRENCIES, PRICE_MATRIX_ROWS, SALE_STATUSES, SALE_STATUS_LABELS, type SaleStatus } from "@/types/tours.types";
import { fmtInstant, formatNumber, isoToJerusalemLocal, jerusalemLocalToIso, parsePrice } from "@/lib/tours/format";

// ---------------------------------------------------------------- data
export interface SheetRow {
  id: string;
  code: string;
  packageId: string;
  seriesCode: string;
  startDate: string;
  endDate: string;
  season: string | null;
  /** "BUD" or "BUD → VIE" (lands in one city, flies home from another). */
  route: string;
  isPublished: boolean;
  saleStatus: string;
  /** What the site shows: the operator's status, or sold out / last places from the seats. */
  siteStatus: string;
  currency: string;
  capacity: number | null;
  seats: { allocated: number; sold: number; remaining: number };
  /** What the flight costs per seat - for reading the margin, never added to the price. */
  flightCost: { amount: number; currency: string; more: number } | null;
  /** Per person, in PRICE_MATRIX_ROWS order; null = no price for that place. */
  prices: (number | null)[];
  labels: string[];
  meetingAt: string | null;
  baggage: boolean;
  meal: boolean;
  transfers: boolean;
  connectionOut: string | null;
  connectionBack: string | null;
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
}

export interface PricingSheetData {
  today: string;
  tours: SheetTour[];
  rows: SheetRow[];
}

export type SheetValue = string | number | boolean | null | string[];

/** The cells of one row that changed: the value the sheet showed, and the new one. */
export interface SheetRowChange {
  id: string;
  cells: Record<string, { before: SheetValue; after: SheetValue }>;
}

export interface SheetSaveOutcome {
  /** Rows saved whole. */
  saved: string[];
  /** Rows not saved, or saved in part, with the reason. */
  skipped: { id: string; code: string; reason: string }[];
  /** The rows as they are now - for every row the save touched. */
  rows: SheetRow[];
}

// ---------------------------------------------------------------- columns
export type SheetKind =
  | "readonly"
  | "price"
  | "int"
  | "money"
  | "bool"
  | "status"
  | "currency"
  | "labels"
  | "datetime"
  | "text";

export type SheetView = "prices" | "details";

export interface SheetColumn {
  key: string;
  label: string;
  /** A longer name for the header's tooltip. */
  title?: string;
  kind: SheetKind;
  views: SheetView[];
  /** Width in px. */
  width: number;
  /** Longest text kept (text columns). */
  max?: number;
  /** Lowest and highest number (int / money columns). */
  min?: number;
  top?: number;
}

/** The price columns, double room first - the price every card and composition starts from. */
const PRICE_ORDER = [1, 0, 2, 3, 4, 5];
const PRICE_SHORT = ["Single", "Double", "3rd adult", "Child 2", "Child 3", "Child 4"];
export const priceKey = (index: number) => `price${index}`;
export const priceIndexOf = (key: string): number | null => {
  const m = /^price([0-5])$/.exec(key);
  return m ? Number(m[1]) : null;
};

export const SHEET_COLUMNS: SheetColumn[] = [
  { key: "dates", label: "Dates", kind: "readonly", views: ["prices", "details"], width: 150 },
  { key: "route", label: "Route", kind: "readonly", views: ["prices"], width: 90 },
  { key: "isPublished", label: "On site", title: "Published on the site", kind: "bool", views: ["prices", "details"], width: 70 },
  { key: "saleStatus", label: "Status", title: "The status you set (the site may show sold out / last places from the seats)", kind: "status", views: ["prices", "details"], width: 120 },
  { key: "seats", label: "Seats", title: "Sold / allocated flight seats", kind: "readonly", views: ["prices"], width: 80 },
  { key: "flightCost", label: "Flight", title: "Flight cost per seat (for the margin - not added to the price)", kind: "readonly", views: ["prices"], width: 90 },
  ...PRICE_ORDER.map(
    (i): SheetColumn => ({
      key: priceKey(i),
      label: PRICE_SHORT[i],
      title: `${PRICE_MATRIX_ROWS[i].label} - price per person`,
      kind: "price",
      views: ["prices"],
      width: 90,
    }),
  ),
  { key: "currency", label: "Cur.", title: "Currency", kind: "currency", views: ["prices", "details"], width: 64 },
  { key: "capacity", label: "Capacity", kind: "int", views: ["details"], width: 84, min: 0, top: 2000 },
  { key: "labels", label: "Labels", title: "Labels on the date (comma between them)", kind: "labels", views: ["details"], width: 180 },
  { key: "meetingAt", label: "Meeting", title: "Team meeting at the airport (Israel time)", kind: "datetime", views: ["details"], width: 140 },
  { key: "baggage", label: "Baggage", kind: "bool", views: ["details"], width: 76 },
  { key: "meal", label: "Meal", kind: "bool", views: ["details"], width: 64 },
  { key: "transfers", label: "Transfers", kind: "bool", views: ["details"], width: 84 },
  { key: "connectionOut", label: "Connection out", kind: "text", views: ["details"], width: 150, max: 300 },
  { key: "connectionBack", label: "Connection back", kind: "text", views: ["details"], width: 150, max: 300 },
  { key: "childMaxAge", label: "Child to", title: "Child up to age (empty = the series')", kind: "int", views: ["details"], width: 76, min: 0, top: 25 },
  { key: "seniorMinAge", label: "Senior from", title: "Senior from age (empty = the series')", kind: "int", views: ["details"], width: 90, min: 40, top: 120 },
  { key: "seniorDiscount", label: "Senior disc.", title: "Senior discount per person (empty = the series')", kind: "money", views: ["details"], width: 90, min: 0, top: 100000 },
  { key: "notes", label: "Notes", kind: "text", views: ["details"], width: 220, max: 4000 },
];

export const columnsFor = (view: SheetView) => SHEET_COLUMNS.filter((c) => c.views.includes(view));
export const columnByKey = new Map(SHEET_COLUMNS.map((c) => [c.key, c]));
export const isEditable = (c: SheetColumn) => c.kind !== "readonly";

/** The value of one editable cell of a row (what the grid shows and what `before` carries). */
export function cellValue(row: SheetRow, key: string): SheetValue {
  const i = priceIndexOf(key);
  if (i !== null) return row.prices[i] ?? null;
  switch (key) {
    case "isPublished":
      return row.isPublished;
    case "saleStatus":
      return row.saleStatus;
    case "currency":
      return row.currency;
    case "capacity":
      return row.capacity;
    case "labels":
      return row.labels;
    case "meetingAt":
      return row.meetingAt;
    case "baggage":
      return row.baggage;
    case "meal":
      return row.meal;
    case "transfers":
      return row.transfers;
    case "connectionOut":
      return row.connectionOut;
    case "connectionBack":
      return row.connectionBack;
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
export const EDITABLE_KEYS = new Set(SHEET_COLUMNS.filter(isEditable).map((c) => c.key));

// ---------------------------------------------------------------- reading what was typed
export type Parsed = { value: SheetValue } | { error: string };

const TRUE_WORDS = new Set(["1", "yes", "y", "true", "v", "x", "✓", "כן", "on"]);
const FALSE_WORDS = new Set(["", "0", "no", "n", "false", "לא", "off", "-"]);

/** What the text typed or pasted into a cell means, or why it means nothing. */
export function parseCell(col: SheetColumn, raw: string): Parsed {
  const text = String(raw ?? "").trim();
  switch (col.kind) {
    case "readonly":
      return { error: "Read-only" };
    case "price": {
      const p = parsePrice(text);
      if (p === undefined) return { error: "A price is a number, e.g. 1290" };
      if (p !== null && p > 1_000_000) return { error: "Too high for a price" };
      return { value: p };
    }
    case "money":
    case "int": {
      if (text === "") return { value: null };
      const n = col.kind === "money" ? parsePrice(text) : /^\d+$/.test(text) ? Number(text) : undefined;
      if (n === undefined || n === null) return { error: col.kind === "int" ? "A whole number" : "A number" };
      if ((col.min !== undefined && n < col.min) || (col.top !== undefined && n > col.top)) {
        return { error: `From ${col.min ?? 0} to ${col.top}` };
      }
      return { value: n };
    }
    case "bool": {
      const t = text.toLowerCase();
      if (TRUE_WORDS.has(t)) return { value: true };
      if (FALSE_WORDS.has(t)) return { value: false };
      return { error: "Yes or no" };
    }
    case "status": {
      const t = text.toLowerCase().replace(/\s+/g, "_");
      const found = SALE_STATUSES.find(
        (s) => s === t || SALE_STATUS_LABELS[s].toLowerCase().replace(/\s+/g, "_") === t,
      );
      return found ? { value: found } : { error: `One of: ${SALE_STATUSES.map((s) => SALE_STATUS_LABELS[s]).join(", ")}` };
    }
    case "currency": {
      const c = text.toUpperCase();
      return (CURRENCIES as readonly string[]).includes(c) ? { value: c } : { error: `One of: ${CURRENCIES.join(", ")}` };
    }
    case "labels": {
      const labels = Array.from(
        new Set(
          text
            .split(/[,;|]/)
            .map((l) => l.trim().slice(0, 60))
            .filter(Boolean),
        ),
      );
      if (labels.length > 6) return { error: "Up to 6 labels" };
      return { value: labels };
    }
    case "datetime": {
      if (text === "") return { value: null };
      // "2026-07-03 05:30", "2026-07-03T05:30" or "03/07/2026 05:30" - Israel time
      let local: string | null = null;
      const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(text);
      const il = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})\s+(\d{1,2}):(\d{2})$/.exec(text);
      const two = (n: string) => n.padStart(2, "0");
      if (iso) local = `${iso[1]}-${iso[2]}-${iso[3]}T${two(iso[4])}:${iso[5]}`;
      else if (il) {
        const year = il[3].length === 2 ? `20${il[3]}` : il[3];
        local = `${year}-${two(il[2])}-${two(il[1])}T${two(il[4])}:${il[5]}`;
      }
      const at = local ? jerusalemLocalToIso(local) : null;
      return at ? { value: at } : { error: "A date and time, e.g. 2026-07-03 05:30" };
    }
    case "text": {
      if (col.max && text.length > col.max) return { error: `Up to ${col.max} characters` };
      return { value: text === "" ? null : text };
    }
  }
}

/** The text a cell opens with for editing. */
export function editText(col: SheetColumn, value: SheetValue): string {
  if (value === null || value === undefined) return "";
  if (col.kind === "labels" && Array.isArray(value)) return value.join(", ");
  if (col.kind === "datetime" && typeof value === "string") return isoToJerusalemLocal(value).replace("T", " ");
  if (col.kind === "bool") return value ? "yes" : "no";
  return String(value);
}

/** The text a cell shows. */
export function displayText(col: SheetColumn, value: SheetValue): string {
  if (value === null || value === undefined) return "";
  switch (col.kind) {
    case "price":
    case "money":
      return typeof value === "number" ? formatNumber(value) : "";
    case "bool":
      return value ? "✓" : "";
    case "status":
      return SALE_STATUS_LABELS[value as SaleStatus] ?? String(value);
    case "labels":
      return Array.isArray(value) ? value.join(", ") : "";
    case "datetime":
      return typeof value === "string" ? fmtInstant(value) : "";
    default:
      return String(value);
  }
}

// ---------------------------------------------------------------- paste and diff
/** A block copied from Excel or Google Sheets: rows of tab-separated cells. */
export function pasteBlock(text: string): string[][] {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => line.split("\t"));
}

const norm = (v: SheetValue): string => JSON.stringify(v === undefined ? null : v);
export const sameValue = (a: SheetValue, b: SheetValue): boolean => norm(a) === norm(b);

/** The changes to send: every edited cell whose value differs from the row as loaded. */
export function rowChanges(rows: Map<string, SheetRow>, edits: Record<string, Record<string, SheetValue>>): SheetRowChange[] {
  const out: SheetRowChange[] = [];
  for (const [id, cells] of Object.entries(edits)) {
    const row = rows.get(id);
    if (!row) continue;
    const changed: SheetRowChange["cells"] = {};
    for (const [key, after] of Object.entries(cells)) {
      const before = cellValue(row, key);
      if (!sameValue(before, after)) changed[key] = { before, after };
    }
    if (Object.keys(changed).length) out.push({ id, cells: changed });
  }
  return out;
}

/** A number cell after "add" or "percent" from Set for Selected. Prices round to whole units. */
export function adjustNumber(current: number | null, mode: "add" | "percent", amount: number): number | null {
  if (current === null || !Number.isFinite(current)) return null;
  const next = mode === "add" ? current + amount : current * (1 + amount / 100);
  return Math.max(0, Math.round(next));
}
