/**
 * Row types and vocabularies of the "tours" product type.
 * Spec: mega-family/docs/plans/MEGA-FAMILY-DATA-SPEC.md and MEGA-FAMILY-FUNCTIONAL-SPEC.md.
 *
 * Row types come from the generated schema (types/database.types.ts). The label
 * maps below are the single place the Hebrew wording of each status lives.
 */
import type { Database } from "./database.types";

type T = Database["tours"]["Tables"];
type P = Database["public"]["Tables"];

export type TourPackage = T["packages"]["Row"];
export type TourItinerary = T["package_itineraries"]["Row"];
export type TourTerm = T["terms"]["Row"];
export type TourSeries = T["series"]["Row"];
export type TourDeparture = T["departures"]["Row"];
export type TourDeparturePrice = T["departure_prices"]["Row"];
export type TourDepartureOption = T["departure_options"]["Row"];
export type TourPromotion = T["promotions"]["Row"];
export type TourSalesEntry = T["departure_sales_entries"]["Row"];
/** An order from the site: a request for a rep, or a card payment (20261003100000). */
export type TourBooking = T["bookings"]["Row"];
export type TourFlightAllocation = T["flight_allocations"]["Row"];
export type TourHotel = T["hotels"]["Row"];
export type TourInstructor = T["instructors"]["Row"];
export type TourCmsPage = T["cms_pages"]["Row"];
export type FlightContract = P["flight_contracts"]["Row"];
export type FlightBlockEvent = P["flight_block_events"]["Row"];
export type CalendarPeriod = P["calendar_periods"]["Row"];
export type CompanyExchangeRate = P["company_exchange_rates"]["Row"];
export type Lead = P["leads"]["Row"];

// ---------------------------------------------------------------- departures
export const SALE_STATUSES = ["open", "guaranteed", "last_places", "sold_out", "closed"] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

/** The red tag next to a date on the site. */
export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  open: "Open",
  guaranteed: "Guaranteed",
  last_places: "Last places",
  sold_out: "Sold out",
  closed: "Closed",
};

export const FLIGHT_MODES = ["included", "priced", "none"] as const;
export type FlightMode = (typeof FLIGHT_MODES)[number];
export const FLIGHT_MODE_LABELS: Record<FlightMode, string> = {
  included: "Flight included",
  priced: "Flight at extra cost",
  none: "No flight",
};

export const CURRENCIES = ["USD", "EUR", "GBP"] as const;
export type TourCurrency = (typeof CURRENCIES)[number];

// ---------------------------------------------------------------- price matrix
export type PaxType = "adult" | "child";

/** The six rows of the occupancy matrix, in the order the price editor shows them. */
export const PRICE_MATRIX_ROWS: { paxType: PaxType; position: number; label: string; sheetKey: string }[] = [
  { paxType: "adult", position: 1, label: "Adult, single room", sheetKey: "adult_single_room" },
  { paxType: "adult", position: 2, label: "Adult in a double room", sheetKey: "adult_double_room" },
  { paxType: "adult", position: 3, label: "Third adult in the room", sheetKey: "third_adult_room" },
  { paxType: "child", position: 2, label: "Second child (adult + child)", sheetKey: "second_kid_room" },
  { paxType: "child", position: 3, label: "Third child in the room", sheetKey: "third_kid_room" },
  { paxType: "child", position: 4, label: "Fourth child in the room", sheetKey: "fourth_kid_room" },
];

// ---------------------------------------------------------------- promotions
export const PROMOTION_KINDS = ["percent_order", "fixed_per_pax", "fixed_per_order", "named_per_pax", "gift"] as const;
export type PromotionKind = (typeof PROMOTION_KINDS)[number];
export const PROMOTION_KIND_LABELS: Record<PromotionKind, string> = {
  percent_order: "% off the order",
  fixed_per_pax: "Fixed discount per traveler",
  fixed_per_order: "Fixed discount per order",
  named_per_pax: "Named discount per traveler",
  gift: "Gift",
};
/** percent_order and fixed_per_pax are either/or on one departure (functional spec, rule 2). */
export const EXCLUSIVE_PROMOTION_KINDS: PromotionKind[] = ["percent_order", "fixed_per_pax"];

export const OPTION_KINDS = ["hotel", "ticket", "villa", "car", "extra"] as const;
export type OptionKind = (typeof OPTION_KINDS)[number];

// ---------------------------------------------------------------- flight blocks
/**
 * Lifecycle of a group flight block. `option` and `ticketed` are the two
 * values Mega Events used before; they stay valid.
 */
export const BLOCK_STATUSES = [
  "approved",
  "requested",
  "declined",
  "option",
  "confirmed",
  "operational",
  "ticketed",
  "cancelled",
] as const;
export type BlockStatus = (typeof BLOCK_STATUSES)[number];

export const BLOCK_STATUS_LABELS: Record<BlockStatus, string> = {
  approved: "Approved to book",
  requested: "Requested",
  declined: "Declined",
  option: "Option",
  confirmed: "Confirmed by airline",
  operational: "Handed to operations",
  ticketed: "Ticketed",
  cancelled: "Cancelled",
};

/** A block that actually holds seats for customers. */
export const LIVE_BLOCK_STATUSES: BlockStatus[] = ["confirmed", "operational", "ticketed"];

/** Allowed next steps from each status (null = a draft with no status yet). */
export const BLOCK_STATUS_TRANSITIONS: Record<BlockStatus | "draft", BlockStatus[]> = {
  draft: ["approved", "requested"],
  approved: ["requested", "declined", "cancelled"],
  requested: ["confirmed", "declined", "cancelled"],
  declined: ["requested"],
  option: ["confirmed", "cancelled"],
  confirmed: ["operational", "cancelled"],
  operational: ["ticketed", "cancelled"],
  ticketed: ["cancelled"],
  cancelled: [],
};

export const BLOCK_EVENT_KINDS = [
  "approved",
  "requested",
  "quoted",
  "confirmed",
  "handed_over",
  "reduced",
  "cleaned",
  "schedule_change",
  "deposit_paid",
  "names_sent",
  "ticketed",
  "cancelled",
  "note",
] as const;
export type BlockEventKind = (typeof BLOCK_EVENT_KINDS)[number];
export const BLOCK_EVENT_LABELS: Record<BlockEventKind, string> = {
  approved: "Approved to book",
  requested: "Requested",
  quoted: "Quote received",
  confirmed: "Confirmed by airline",
  handed_over: "Handed to operations",
  reduced: "Seats reduced",
  cleaned: "Seats released",
  schedule_change: "Schedule change",
  deposit_paid: "Deposit paid",
  names_sent: "Names sent",
  ticketed: "Ticketed",
  cancelled: "Cancelled",
  note: "Note",
};

export const CALENDAR_KINDS = ["holiday", "fast", "carnival", "school_break", "other"] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];
export const CALENDAR_KIND_LABELS: Record<CalendarKind, string> = {
  holiday: "Holiday",
  fast: "Fast",
  carnival: "Carnival",
  school_break: "School break",
  other: "Other",
};

export const LEAD_KIND_LABELS: Record<string, string> = {
  lead: "Lead form",
  contact: "Contact us",
  cancellation: "Cancellation request",
  newsletter: "Newsletter",
  advisor: "Advisor request (booking)",
  booking: "Online booking (card)",
};

/** The numeric id the customer site uses for a departure (?product_id=). */
export const departureSiteId = (d: Pick<TourDeparture, "legacy_product_id" | "site_id">): number =>
  d.legacy_product_id ?? Number(d.site_id);
