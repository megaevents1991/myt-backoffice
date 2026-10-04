/**
 * The Offline Flights sheet of a tours company (Alon, 04.10.2026 - "like the
 * pricing sheet, with a details / operations switch and the tour code of every
 * flight"). Pure model, shared by the grid (flights-sheet.tsx), its server
 * actions (lib/actions/tours-flights-sheet-actions.ts) and the selftest. What a
 * cell is and how typed text is read: ../sheet/sheet-core.ts.
 *
 * One row = one flight block. Two column sets over the same rows:
 *   details    - the flight itself: series, airline, both legs, baggage, stops,
 *                costs, supplier, PNR;
 *   operations - the work on the block: its status, seats (ordered, now,
 *                allocated, left), when it was requested and every deadline -
 *                option, the two cancellation dates, names, ticketing, payment.
 * Both start with the tour code - the sub-tours the block serves (BBC712).
 */
import { BLOCK_STATUS_LABELS, CURRENCIES, type BlockStatus } from "@/types/tours.types";
import { nextStages, stageLabel, stageOf } from "@/components/tours/flights/block-rules";
import type { SheetColumn as CoreColumn, SheetOption, SheetValue } from "@/components/tours/sheet/sheet-core";

export type FlightView = "details" | "operations";
export const FLIGHT_VIEWS: readonly FlightView[] = ["details", "operations"];
export const FLIGHT_VIEW_LABELS: Record<FlightView, string> = { details: "Details", operations: "Operations" };
export type FlightColumn = CoreColumn<FlightView>;

export interface FlightSheetRow {
  /** The flight id as text - the grid's row key. */
  id: string;
  flightId: number;
  /** The sub-tours this block serves, by code - and whether the link is on the site already. */
  tours: { code: string; seats: number; legs: string }[];
  series: string | null;
  seasonLabel: string | null;
  airline: string;
  inboundAirline: string | null;
  outNumber: string;
  outFrom: string;
  outTo: string;
  /** Local wall time, "2026-07-03T06:10". */
  outDepart: string;
  outArrive: string;
  inNumber: string;
  inFrom: string;
  inTo: string;
  inDepart: string;
  inArrive: string;
  checkedBagKg: number | null;
  cabinBagKg: number | null;
  outStop: string | null;
  inStop: string | null;
  cabinClass: string | null;
  aircraft: string | null;
  costAdult: number | null;
  costChild: number | null;
  costTax: number | null;
  costCurrency: string | null;
  supplier: string | null;
  pnr: string | null;
  groupCode: string | null;
  notes: string | null;
  // operations
  /** null = a draft with no status yet. */
  status: string | null;
  seats: number;
  /** Seats first ordered, once the count changed; null = never changed. */
  originalSeats: number | null;
  /** Seats spoken for by sub-tours. */
  allocated: number;
  requestedAt: string | null;
  optionExpiry: string | null;
  firstCancel: string | null;
  lastCancel: string | null;
  namesDeadline: string | null;
  ticketingDeadline: string | null;
  paymentDeadline: string | null;
  handledBy: string | null;
  reviewed: boolean;
  /** "12.08.26 · בוטל על ידי חברת התעופה: ..." for a cancelled block. */
  cancelled: string | null;
}

export interface FlightsSheetData {
  today: string;
  rows: FlightSheetRow[];
  /** The viewer may mark a row Reviewed and approve a block to book. */
  isManager: boolean;
}

// ---------------------------------------------------------------- columns
const CURRENCY_OPTIONS: SheetOption[] = CURRENCIES.map((c) => ({ value: c, label: c }));

const VIEW_ORDER: Record<FlightView, string[]> = {
  details: [
    "tourCode",
    "series",
    "seasonLabel",
    "airline",
    "outNumber",
    "outFrom",
    "outTo",
    "outDepart",
    "outArrive",
    "inboundAirline",
    "inNumber",
    "inFrom",
    "inTo",
    "inDepart",
    "inArrive",
    "seatsShown",
    "costAdult",
    "costChild",
    "costTax",
    "costCurrency",
    "checkedBagKg",
    "cabinBagKg",
    "outStop",
    "inStop",
    "cabinClass",
    "aircraft",
    "supplier",
    "pnr",
    "groupCode",
    "notes",
  ],
  operations: [
    "tourCode",
    "flies",
    "status",
    "seats",
    "originalSeats",
    "allocated",
    "left",
    "requestedAt",
    "optionExpiry",
    "firstCancel",
    "lastCancel",
    "namesDeadline",
    "ticketingDeadline",
    "paymentDeadline",
    "pnr",
    "handledBy",
    "reviewed",
    "cancelled",
    "notes",
  ],
};

type ColumnDef = Omit<FlightColumn, "views">;
const airport = (key: string, label: string, title: string): ColumnDef => ({
  key,
  label,
  title,
  kind: "text",
  width: 64,
  upper: true,
  exact: 3,
  required: true,
});
const DEFS: ColumnDef[] = [
  { key: "tourCode", label: "Tour code", title: "The sub-tours this flight serves (the tour code + the date, e.g. BBC712)", kind: "readonly", width: 120 },
  { key: "flies", label: "Flies", title: "Out and back", kind: "readonly", width: 150 },
  { key: "series", label: "Series", title: "The flight series - for an organized tour, its tour code", kind: "text", width: 90, max: 60, noBulk: true },
  { key: "seasonLabel", label: "Season", title: "The season label of the flight", kind: "text", width: 100, max: 60 },
  { key: "airline", label: "Airline", title: "Airline code, outbound (LY)", kind: "text", width: 70, upper: true, max: 3, required: true },
  { key: "outNumber", label: "Out flight", title: "Outbound flight number", kind: "text", width: 90, max: 10, required: true, noBulk: true },
  airport("outFrom", "From", "Outbound: departs from"),
  airport("outTo", "To", "Outbound: lands in"),
  { key: "outDepart", label: "Out departs", title: "Outbound departure, local time", kind: "localtime", width: 150, noBulk: true },
  { key: "outArrive", label: "Out lands", title: "Outbound arrival, local time", kind: "localtime", width: 150, noBulk: true },
  { key: "inboundAirline", label: "Back airline", title: "Airline of the return leg, when it is another one", kind: "text", width: 96, upper: true, max: 3 },
  { key: "inNumber", label: "Back flight", title: "Return flight number", kind: "text", width: 90, max: 10, required: true, noBulk: true },
  airport("inFrom", "From", "Return: departs from"),
  airport("inTo", "To", "Return: lands in"),
  { key: "inDepart", label: "Back departs", title: "Return departure, local time", kind: "localtime", width: 150, noBulk: true },
  { key: "inArrive", label: "Back lands", title: "Return arrival, local time", kind: "localtime", width: 150, noBulk: true },
  { key: "seatsShown", label: "Seats", title: "Seats of the block now - changed on the Operations columns", kind: "readonly", width: 64 },
  { key: "costAdult", label: "Adult cost", title: "Cost per adult seat", kind: "money", width: 90, min: 0, top: 1_000_000 },
  { key: "costChild", label: "Child cost", title: "Cost per child seat", kind: "money", width: 90, min: 0, top: 1_000_000 },
  { key: "costTax", label: "Tax", title: "Tax per seat", kind: "money", width: 76, min: 0, top: 1_000_000 },
  { key: "costCurrency", label: "Cur.", title: "Currency of the costs", kind: "choice", options: CURRENCY_OPTIONS, nullable: true, width: 64 },
  { key: "checkedBagKg", label: "Bag kg", title: "Checked baggage per traveler, kg", kind: "int", width: 70, min: 0, top: 100 },
  { key: "cabinBagKg", label: "Cabin kg", title: "Cabin baggage per traveler, kg", kind: "int", width: 76, min: 0, top: 50 },
  { key: "outStop", label: "Out stop", title: "Connection airport on the way out (empty = direct)", kind: "text", width: 76, upper: true, exact: 3 },
  { key: "inStop", label: "Back stop", title: "Connection airport on the way back (empty = direct)", kind: "text", width: 80, upper: true, exact: 3 },
  { key: "cabinClass", label: "Class", kind: "text", width: 80, max: 40 },
  { key: "aircraft", label: "Aircraft", kind: "text", width: 90, max: 40 },
  { key: "supplier", label: "Supplier", kind: "text", width: 120, max: 120 },
  { key: "pnr", label: "PNR", kind: "text", width: 90, max: 40, noBulk: true },
  { key: "groupCode", label: "Group code", kind: "text", width: 100, max: 60, noBulk: true },
  { key: "notes", label: "Notes", kind: "text", width: 220, max: 4000 },
  {
    key: "status",
    label: "Status",
    title: "The next step of the block. Declining or cancelling a block needs a reason - on the flight's page",
    kind: "choice",
    width: 160,
    noBulk: true,
  },
  { key: "seats", label: "Seats", title: "Seats of the block now. Lowering it releases seats back to the airline", kind: "int", width: 70, min: 0, top: 2000, required: true, noBulk: true },
  { key: "originalSeats", label: "Ordered", title: "Seats first ordered", kind: "readonly", width: 70 },
  { key: "allocated", label: "Allocated", title: "Seats given to sub-tours", kind: "readonly", width: 78 },
  { key: "left", label: "Free", title: "Seats of the block not given to any sub-tour", kind: "readonly", width: 60 },
  { key: "requestedAt", label: "Requested", title: "When the block was requested from the airline", kind: "date", width: 104 },
  { key: "optionExpiry", label: "Option until", title: "The option expires", kind: "date", width: 104 },
  { key: "firstCancel", label: "Cancel 1", title: "First cancellation date (CXX 1) - free release until then", kind: "date", width: 104 },
  { key: "lastCancel", label: "Cancel 2", title: "Last cancellation date (CXX 2)", kind: "date", width: 104 },
  { key: "namesDeadline", label: "Names", title: "Name list to the airline by", kind: "date", width: 104 },
  { key: "ticketingDeadline", label: "Ticketing", title: "Ticketing deadline", kind: "date", width: 104 },
  { key: "paymentDeadline", label: "Payment", title: "Payment deadline", kind: "date", width: 104 },
  { key: "handledBy", label: "Handled by", title: "Who works on this block", kind: "text", width: 110, max: 80 },
  { key: "reviewed", label: "Reviewed", title: "A manager went over this row", kind: "bool", width: 80 },
  { key: "cancelled", label: "Cancelled", title: "When and why the block was cancelled", kind: "readonly", width: 200 },
];

export const FLIGHT_COLUMNS: FlightColumn[] = DEFS.map((c) => ({
  ...c,
  views: FLIGHT_VIEWS.filter((v) => VIEW_ORDER[v].includes(c.key)),
}));
export const flightColumnByKey = new Map(FLIGHT_COLUMNS.map((c) => [c.key, c]));
export const flightColumnsFor = (view: FlightView): FlightColumn[] =>
  VIEW_ORDER[view].map((key) => flightColumnByKey.get(key)).filter((c): c is FlightColumn => !!c);
export const FLIGHT_EDITABLE_KEYS = new Set(FLIGHT_COLUMNS.filter((c) => c.kind !== "readonly").map((c) => c.key));

/** The value of one editable cell (what the grid shows and what `before` carries). */
export function flightCellValue(row: FlightSheetRow, key: string): SheetValue {
  switch (key) {
    case "status":
      return row.status;
    case "series":
    case "seasonLabel":
    case "airline":
    case "inboundAirline":
    case "outNumber":
    case "outFrom":
    case "outTo":
    case "outDepart":
    case "outArrive":
    case "inNumber":
    case "inFrom":
    case "inTo":
    case "inDepart":
    case "inArrive":
    case "checkedBagKg":
    case "cabinBagKg":
    case "outStop":
    case "inStop":
    case "cabinClass":
    case "aircraft":
    case "costAdult":
    case "costChild":
    case "costTax":
    case "costCurrency":
    case "supplier":
    case "pnr":
    case "groupCode":
    case "notes":
    case "seats":
    case "requestedAt":
    case "optionExpiry":
    case "firstCancel":
    case "lastCancel":
    case "namesDeadline":
    case "ticketingDeadline":
    case "paymentDeadline":
    case "handledBy":
    case "reviewed":
      return row[key];
    default:
      return null;
  }
}

/** Steps taken on the flight's page, where the reason is asked for. */
const NEEDS_A_REASON: readonly BlockStatus[] = ["declined", "cancelled"];

/**
 * What the Status cell of a row offers: where the block stands, and the steps it
 * may take from there that need nothing more than the click.
 */
export function statusOptions(status: string | null): SheetOption[] {
  const here = stageOf(status);
  const out: SheetOption[] = here === "draft" ? [] : [{ value: here, label: BLOCK_STATUS_LABELS[here] }];
  for (const next of nextStages(status)) {
    if (!NEEDS_A_REASON.includes(next)) out.push({ value: next, label: BLOCK_STATUS_LABELS[next] });
  }
  return out;
}

export const statusText = (status: string | null): string => stageLabel(status);
