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
  open: "בהרשמה",
  guaranteed: "מובטח",
  last_places: "מקומות אחרונים",
  sold_out: "מלא",
  closed: "סגור",
};

export const FLIGHT_MODES = ["included", "priced", "none"] as const;
export type FlightMode = (typeof FLIGHT_MODES)[number];
export const FLIGHT_MODE_LABELS: Record<FlightMode, string> = {
  included: "טיסה כלולה במחיר",
  priced: "טיסה בתוספת מחיר",
  none: "ללא טיסה",
};

export const CURRENCIES = ["USD", "EUR", "GBP"] as const;
export type TourCurrency = (typeof CURRENCIES)[number];

// ---------------------------------------------------------------- price matrix
export type PaxType = "adult" | "child";

/** The six rows of the occupancy matrix, in the order the price editor shows them. */
export const PRICE_MATRIX_ROWS: { paxType: PaxType; position: number; label: string; sheetKey: string }[] = [
  { paxType: "adult", position: 1, label: "מבוגר יחיד בחדר", sheetKey: "adult_single_room" },
  { paxType: "adult", position: 2, label: "מבוגר בחדר זוגי", sheetKey: "adult_double_room" },
  { paxType: "adult", position: 3, label: "מבוגר שלישי בחדר", sheetKey: "third_adult_room" },
  { paxType: "child", position: 2, label: "ילד שני בחדר (מבוגר + ילד)", sheetKey: "second_kid_room" },
  { paxType: "child", position: 3, label: "ילד שלישי בחדר", sheetKey: "third_kid_room" },
  { paxType: "child", position: 4, label: "ילד רביעי בחדר", sheetKey: "fourth_kid_room" },
];

// ---------------------------------------------------------------- promotions
export const PROMOTION_KINDS = ["percent_order", "fixed_per_pax", "fixed_per_order", "named_per_pax", "gift"] as const;
export type PromotionKind = (typeof PROMOTION_KINDS)[number];
export const PROMOTION_KIND_LABELS: Record<PromotionKind, string> = {
  percent_order: "אחוז הנחה מההזמנה",
  fixed_per_pax: "הנחה בסכום קבוע לנוסע",
  fixed_per_order: "הנחה בסכום קבוע להזמנה",
  named_per_pax: "הנחה בשם, לנוסע",
  gift: "מתנה",
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
  approved: "אושר להזמנה",
  requested: "נשלחה בקשה",
  declined: "נדחה",
  option: "אופציה",
  confirmed: "אושר בחברת התעופה",
  operational: "הועבר לתפעול",
  ticketed: "כורטס",
  cancelled: "בוטל",
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
  approved: "אושר להזמנה",
  requested: "נשלחה בקשה",
  quoted: "התקבלה הצעת מחיר",
  confirmed: "אושר בחברת התעופה",
  handed_over: "הועבר לתפעול",
  reduced: "הורדת מושבים",
  cleaned: "ניקוי מושבים",
  schedule_change: "שינוי לוח זמנים",
  deposit_paid: "שולמה מקדמה",
  names_sent: "נשלחו שמות",
  ticketed: "כורטס",
  cancelled: "בוטל",
  note: "הערה",
};

export const CALENDAR_KINDS = ["holiday", "fast", "carnival", "school_break", "other"] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];
export const CALENDAR_KIND_LABELS: Record<CalendarKind, string> = {
  holiday: "חג",
  fast: "צום",
  carnival: "קרנבל",
  school_break: "חופשת בתי ספר",
  other: "אחר",
};

export const LEAD_KIND_LABELS: Record<string, string> = {
  lead: "טופס לידים",
  contact: "צור קשר",
  cancellation: "בקשת ביטול",
  newsletter: "ניוזלטר",
  advisor: "בקשה ליועץ (הזמנה)",
};

/** The numeric id the customer site uses for a departure (?product_id=). */
export const departureSiteId = (d: Pick<TourDeparture, "legacy_product_id" | "site_id">): number =>
  d.legacy_product_id ?? Number(d.site_id);
