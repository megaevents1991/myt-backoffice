/**
 * What the builder chose by itself, as plain Hebrew lines with a `code` (tour uploader, build
 * step 9), and the diff of what staff then changed in the editor. Pure - no DB, no network.
 *
 * A decision is `{ code, text }`: the code is what the selftest asserts and what the agent's
 * lessons count, the text is what the review card shows so staff can overrule it. Each text is a
 * function of a flat params record (strings and numbers only - it is stored on the item), and a
 * missing param prints as nothing, never as "undefined". Hebrew copy the spec quotes is verbatim.
 *
 * `editDiff` compares the payload the builder stored on the item with the live `events` row after
 * staff worked on it, over `EDIT_WHITELIST` only - the edit is what the agent learns from
 * (`uploader.edited`), so a field outside the list never counts as one.
 *
 * Selftest: scripts/tour-uploader-selftest.ts. Spec: docs/superpowers/specs/2026-10-21-tour-uploader-agent-design.md (9.9).
 */
import { NEAR_LOCATION_KM } from "@/lib/uploader/constants";
import type { Decision } from "@/types/uploader.types";

export type DecisionParams = Record<string, string | number>;
type DecisionText = (p: DecisionParams) => string;

/** A param as text; a param the caller did not pass is empty. */
const str = (p: DecisionParams, key: string): string => String(p[key] ?? "");

/** "קטגוריה אחת" for one, "N קטגוריות" otherwise. */
function categories(p: DecisionParams): string {
  return Number(p.count) === 1 ? "קטגוריה אחת" : `${str(p, "count")} קטגוריות`;
}

/** A Hebrew one-letter prefix on a name: glued to a Hebrew name ("בלונדון"), hyphenated to a Latin one ("ב-London"). */
function withPrefix(prefix: string, name: string): string {
  return /^[A-Za-z]/.test(name) ? `${prefix}-${name}` : `${prefix}${name}`;
}

/**
 * The text of each decision code. Params per code:
 *  location_found {city, iata, km} · tickets_tixstock / tickets_livetickets {count} ·
 *  categories_dropped {count, reason} · zones_from_template {zoned, total} · dates_smart {depart, ret} ·
 *  base_prices {flight, hotel} · prior_answer {name, run} · lodging_from_memory {event} ·
 *  tribute_excluded {name} · duplicate_dropped {name, event_id} ·
 *  two_city_from_memory {event, show_city, flight_city, lodging?} · two_city_chosen {show_city, flight_city, km} ·
 *  rejected_before {run, by, reason}
 */
export const DECISION_TEXT = {
  location_found: (p) => `מיקום: ${str(p, "city")} (${str(p, "iata")}), ${str(p, "km")} ק"מ מהאולם`,
  location_missing_ticket_only: () => `אין מיקום עם טיסות בטווח ${NEAR_LOCATION_KM} ק"מ מהאולם - נבנה ככרטיס בלבד`,
  tickets_tixstock: (p) => `${categories(p)} מ-TixStock`,
  tickets_livetickets: (p) => `${categories(p)} מ-LiveTickets (ניתנות למכירה בלבד)`,
  categories_dropped: (p) =>
    Number(p.count) === 1 ? `קטגוריה אחת ${str(p, "reason")} הושמטה` : `${categories(p)} ${str(p, "reason")} הושמטו`,
  zones_from_template: (p) => `${str(p, "zoned")} מתוך ${str(p, "total")} כרטיסים שויכו לזונים מתבנית האולם`,
  dates_smart: (p) => `טיסות ${str(p, "depart")} → ${str(p, "ret")}`,
  base_prices: (p) => `בסיס מהכלל: טיסה $${str(p, "flight")} · מלון $${str(p, "hotel")}`,
  prior_answer: (p) => `לפי תשובה קודמת של ${str(p, "name")} (ריצה #${str(p, "run")})`,
  lodging_from_memory: (p) => `לינה לפי האירוע האחרון באולם: ${str(p, "event")}`,
  tribute_excluded: (p) => `${str(p, "name")} - הופעת מחווה (tribute), לא נבנתה`,
  duplicate_dropped: (p) => `${str(p, "name")} כבר קיים באתר (אירוע #${str(p, "event_id")}) - לא נבנה שוב`,
  two_city_from_memory: (p) =>
    `דו-עירוני כמו ${str(p, "event")}: הופעה ${withPrefix("ב", str(p, "show_city"))}, טיסה ${withPrefix("ל", str(p, "flight_city"))}, ${str(p, "lodging") || "פיצול מלון"}`,
  two_city_chosen: (p) =>
    `דו-עירוני לפי בחירת צוות: הופעה ${withPrefix("ב", str(p, "show_city"))}, טיסה ${withPrefix("ל", str(p, "flight_city"))} (${str(p, "km")} ק"מ), פיצול מלון`,
  rejected_before: (p) => `נדחתה בריצה #${str(p, "run")} על ידי ${str(p, "by")}${str(p, "reason") === "" ? "" : `: ${str(p, "reason")}`}`,
} satisfies Record<string, DecisionText>;

export type DecisionCode = keyof typeof DECISION_TEXT;

/** A decision line: the code and its filled-in Hebrew text. */
export function decision(code: DecisionCode, p: DecisionParams = {}): Decision {
  return { code, text: DECISION_TEXT[code](p) };
}

/**
 * The event fields whose change by staff counts as an edit. `tickets_count` is derived (how many
 * tickets the event carries); the rest are columns of `events`.
 */
export const EDIT_WHITELIST = [
  "name",
  "name_english",
  "date",
  "def_date_depart",
  "def_date_return",
  "base_flight_price",
  "base_hotel_price",
  "event_additional_markup",
  "ticket_only_markup",
  "package_mode",
  "location",
  "event_location",
  "lodging_mode",
  "lodging_default",
  "split_default_nights",
  "tickets_count",
] as const;

/** JSON with the keys of every object sorted: jsonb hands keys back in its own order, so key order must not make two equal objects differ. */
function stable(v: unknown): string {
  if (v === undefined) return "null";
  return JSON.stringify(v, (_key, value: unknown) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  });
}

/** The value of one whitelisted field; `undefined` = the object does not carry it at all. */
function fieldOf(o: Record<string, unknown>, field: (typeof EDIT_WHITELIST)[number]): unknown {
  if (field !== "tickets_count") return o[field];
  if (o.tickets_and_rates === undefined) return undefined;
  return Array.isArray(o.tickets_and_rates) ? o.tickets_and_rates.length : 0;
}

/**
 * What staff changed: `payload` is what the builder stored on the item (the `createEvent` input),
 * `row` the live `events` row now. Only whitelisted fields are compared, in whitelist order. A field
 * one side does not carry at all (the builder never set `lodging_mode`; the row has its DB default)
 * is not an edit. No live row (deleted) or no stored payload -> nothing to compare -> `[]`.
 */
export function editDiff(
  payload: Record<string, unknown> | null,
  row: Record<string, unknown> | null,
): { field: string; from: unknown; to: unknown }[] {
  if (payload === null || row === null) return [];
  const out: { field: string; from: unknown; to: unknown }[] = [];
  for (const field of EDIT_WHITELIST) {
    const from = fieldOf(payload, field);
    const to = fieldOf(row, field);
    if (from === undefined || to === undefined) continue;
    if (stable(from) !== stable(to)) out.push({ field, from, to });
  }
  return out;
}
