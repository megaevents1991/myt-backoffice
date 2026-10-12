/**
 * How an audit row reads on the screen - pure, no DB (scripts/audit-display-selftest.ts).
 *
 * The /audit-log screen showed a row as "offline_flight #57" and its change as
 * raw JSON, so "who moved this flight's landing to July?" meant opening rows one
 * by one and reading ISO dates by eye (2026-10-12). Nothing new is recorded:
 * these helpers only turn what `audit_log.changes` already holds into a
 * field-by-field diff with the forms' own labels, formatted dates and money,
 * the fields that changed named on the row itself, and a free-text search over
 * the rows on screen.
 */

/** One line of a change: a field, what it was, what it became. */
export type AuditDiffRow = {
  key: string;
  from: unknown;
  to: unknown;
  /** The row came from a {from, to} pair (an update); a create lists values alone. */
  pair: boolean;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isPair = (v: unknown): v is { from: unknown; to: unknown } =>
  isRecord(v) && "from" in v && "to" in v && Object.keys(v).length === 2;

/**
 * The rows of a change. An update's `changes` is `{ field: { from, to } }`
 * (diffChanges); a create's is the whole row. Anything else (a string, an
 * array, null) has no rows - the screen falls back to the raw value.
 */
export function auditDiffRows(changes: unknown): AuditDiffRow[] {
  if (!isRecord(changes)) return [];
  const entries = Object.entries(changes);
  if (entries.length === 0) return [];
  const allPairs = entries.every(([, v]) => isPair(v));
  if (allPairs) {
    return entries.map(([key, v]) => {
      const { from, to } = v as { from: unknown; to: unknown };
      return { key, from, to, pair: true };
    });
  }
  return entries.map(([key, to]) => ({ key, from: undefined, to, pair: false }));
}

/** The names of the fields a change touched, the way the row prints them. */
export function changedKeys(changes: unknown): string[] {
  return auditDiffRows(changes).map((r) => r.key);
}

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const two = (n: number) => String(n).padStart(2, "0");

/**
 * A stored value as a person reads it: an ISO timestamp as DD/MM/YYYY HH:mm
 * (local, the way the forms show it), a date as DD/MM/YYYY, booleans as Yes /
 * No, nothing as "—", objects and arrays as compact JSON (cut at `max`).
 */
export function formatAuditValue(value: unknown, max = 160): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (ISO_DATE.test(value)) {
      const [y, m, d] = value.split("-");
      return `${d}/${m}/${y}`;
    }
    if (ISO_DATETIME.test(value)) {
      const t = new Date(value);
      if (!Number.isNaN(t.getTime())) {
        return `${two(t.getDate())}/${two(t.getMonth() + 1)}/${t.getFullYear()} ${two(t.getHours())}:${two(t.getMinutes())}`;
      }
    }
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
  }
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    json = String(value);
  }
  return json.length > max ? `${json.slice(0, max - 1)}…` : json;
}

/**
 * When a row was written, as the office reads it: Israel time, DD/MM/YYYY HH:mm.
 * The same on the server (a "Last change" line) and in the browser (the table),
 * so the two never disagree by the server's own zone.
 */
export function formatAuditTime(iso: string, timeZone = "Asia/Jerusalem"): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(t);
  } catch {
    return t.toISOString().slice(0, 16).replace("T", " ");
  }
}

/** A time, a date or money moved - the change a reader is usually hunting for. */
export function isSensitiveKey(key: string): boolean {
  return /(_time|_date|_at|price|cost|quantity|deadline|expiry)$|^(price|date|cost)$|event_ids/.test(key);
}

/** "outbound_arrival_time" -> "Outbound arrival time" when no form label is known. */
export function humanizeKey(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/** The labels the event editor uses for the columns a reader meets most. */
export const EVENT_FIELD_LABELS: Record<string, string> = {
  name: "Name",
  name_english: "English name",
  date: "Event date",
  def_date_depart: "Default departure",
  def_date_return: "Default return",
  base_flight_price: "Base flight price (USD)",
  base_hotel_price: "Base hotel price (USD)",
  event_additional_markup: "Package markup",
  ticket_only_markup: "Ticket-only markup",
  package_mode: "Package mode",
  tickets_and_rates: "Tickets & rates",
  location: "Location",
  event_location: "Event city",
  is_deleted: "Deleted",
  available: "Available",
  tags: "Tags",
  skip_flight: "Skip flight",
  skip_hotel: "Skip hotel",
  ready_package_mode: "Ready package",
};

/**
 * A row's text for the search box: actor, action, entity, its label and every
 * value of the change - so "20/07", "סלין" or "LY123" all find it. Dates are
 * indexed both raw (2027-07-20) and as printed (20/07/2027).
 */
export function auditSearchText(row: {
  actor_email?: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  entity_label?: string | null;
  changes?: unknown;
  metadata?: unknown;
}): string {
  const parts: string[] = [
    row.actor_email ?? "",
    row.action,
    row.entity_type ?? "",
    row.entity_id ?? "",
    row.entity_label ?? "",
  ];
  for (const r of auditDiffRows(row.changes)) {
    parts.push(r.key, humanizeKey(r.key));
    for (const v of [r.from, r.to]) {
      if (v === undefined || v === null) continue;
      parts.push(typeof v === "string" ? v : JSON.stringify(v), formatAuditValue(v, 10_000));
    }
  }
  if (row.metadata != null) {
    try {
      parts.push(JSON.stringify(row.metadata));
    } catch {
      /* unprintable metadata is not searchable */
    }
  }
  return parts.join(" \n ").toLowerCase();
}

/** Every word of the query has to appear somewhere in the row (any order). */
export function matchesAuditSearch(text: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  return words.every((w) => text.includes(w));
}

/** Where the entity a row names lives in the dashboard, when it has a page. */
export function auditEntityHref(entityType: string | null | undefined, entityId: string | null | undefined): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case "event":
      return `/events/${entityId}`;
    case "offline_flight":
    case "flight":
      return `/offline-flights/${entityId}`;
    case "offline_hotel":
      return `/offline-hotels/${entityId}`;
    case "reservation":
      return `/reservations/${entityId}`;
    case "partner":
      return `/partners/${encodeURIComponent(entityId)}/view`;
    default:
      return null;
  }
}

/** The audit screen filtered to one entity - what a "History" button opens. */
export function auditHistoryHref(entityType: string, entityId: string | number): string {
  return `/audit-log?entity=${encodeURIComponent(entityType)}&id=${encodeURIComponent(String(entityId))}`;
}

/** "LY123 TLV→CDG 20/05/2027" - a flight named the way the list names it. */
export function flightAuditLabel(f: {
  airline_code?: string | null;
  outbound_flight_number?: string | null;
  outbound_departure_airport?: string | null;
  outbound_arrival_airport?: string | null;
  outbound_departure_time?: string | null;
}): string {
  const number = f.outbound_flight_number?.trim() || f.airline_code?.trim() || "";
  const route =
    f.outbound_departure_airport && f.outbound_arrival_airport
      ? `${f.outbound_departure_airport}→${f.outbound_arrival_airport}`
      : "";
  const day = f.outbound_departure_time ? formatAuditValue(f.outbound_departure_time.slice(0, 10)) : "";
  return [number, route, day].filter(Boolean).join(" ");
}
