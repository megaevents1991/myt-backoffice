// Bulk markup edit on the events table (2026-10-25, Dor: "עריכה מרובה של אדישנל מארק אפ כמו
// טיקט אונלי"). Pure - the server action re-checks everything here before it writes.

/** The two markup columns the bulk bar may set - nothing else rides along (no spread payload). */
export const BULK_MARKUP_COLUMNS = ["event_additional_markup", "ticket_only_markup"] as const;
export type BulkMarkupColumn = (typeof BULK_MARKUP_COLUMNS)[number];

/** A markup past this (USD per person / per ticket) is a typo, never a decision. */
export const MARKUP_MAX_USD = 5000;

/** One bulk edit touches at most this many events (the table holds ~900). */
export const BULK_MARKUP_MAX_EVENTS = 1000;

export const MARKUP_COLUMN_LABEL: Record<BulkMarkupColumn, string> = {
  event_additional_markup: "Additional markup",
  ticket_only_markup: "Ticket-only markup",
};

export type ParsedMarkup =
  | { ok: true; column: BulkMarkupColumn; value: number | null }
  | { ok: false; error: string };

/**
 * `raw` null / "" = clear the column. `event_additional_markup` is a smallint added to every
 * flow's price on main (`getEventAdditionalMarkup`), so a whole number that may be negative;
 * `ticket_only_markup` is what a ticket-only buyer pays over the ticket cost, so never below 0.
 */
export function parseBulkMarkup(column: unknown, raw: unknown): ParsedMarkup {
  if (!BULK_MARKUP_COLUMNS.includes(column as BulkMarkupColumn)) {
    return { ok: false, error: "Unknown markup column." };
  }
  const col = column as BulkMarkupColumn;
  if (raw === null || (typeof raw === "string" && raw.trim() === "")) {
    return { ok: true, column: col, value: null };
  }
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : Number.NaN;
  if (!Number.isFinite(value)) return { ok: false, error: "Enter a number (USD)." };
  if (col === "event_additional_markup" && !Number.isInteger(value)) {
    return { ok: false, error: "Additional markup is a whole number of dollars." };
  }
  const min = col === "ticket_only_markup" ? 0 : -MARKUP_MAX_USD;
  if (value < min || value > MARKUP_MAX_USD) {
    return {
      ok: false,
      error: `Enter a value between ${min} and ${MARKUP_MAX_USD} (USD).`,
    };
  }
  return { ok: true, column: col, value };
}

/** Distinct positive integer ids, or null when the list is empty, too long or holds junk. */
export function cleanEventIds(ids: unknown): number[] | null {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > BULK_MARKUP_MAX_EVENTS) return null;
  const out = new Set<number>();
  for (const id of ids) {
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return null;
    out.add(id);
  }
  return [...out];
}
