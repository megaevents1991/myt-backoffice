/**
 * Header filters of a table - Excel's "filter by what is in the column" (Alon 28.10: "דאבל קליק על השורה הראשונה עם
 * השדות ולפלטר לפי דברים שיש שם, בהקלדה / בגלילה תלוי בשדה, אפשרות לסינון מרובה"). Pure, so the rules are tested
 * apart from the popover (scripts/table-filters-selftest.ts); `components/data-table.tsx` applies them.
 *
 * Three kinds, one per column: VALUES (tick any of the column's values - OR inside the column), TEXT (the board's
 * token search over the cell) and DATE (a day range, inclusive). Columns combine with AND, and with the search box.
 */
import { matchesSearch } from "@/lib/search";

export type HeaderFilterKind = "values" | "text" | "date";
export type HeaderFilterValue =
  | { kind: "values"; values: string[] }
  | { kind: "text"; text: string }
  | { kind: "date"; from: string | null; to: string | null };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** What a values filter prints for an empty cell when the column names nothing better. */
const EMPTY_LABEL = "None";
/** Values named in a chip before "+N". */
const SUMMARY_VALUES = 3;

/** Does one cell (as the column reads it) pass the column's filter? */
export function matchesHeaderFilter(cell: string, filter: HeaderFilterValue): boolean {
  switch (filter.kind) {
    case "values":
      return filter.values.includes(cell);
    case "text":
      return matchesSearch(filter.text, cell);
    case "date": {
      const day = cell.slice(0, 10);
      if (!DAY.test(day)) return false;
      return (!filter.from || day >= filter.from) && (!filter.to || day <= filter.to);
    }
  }
}

/** A filter that narrows nothing is no filter - nothing ticked, nothing typed, no bound. */
export function isActiveFilter(filter: HeaderFilterValue): boolean {
  switch (filter.kind) {
    case "values":
      return filter.values.length > 0;
    case "text":
      return filter.text.trim() !== "";
    case "date":
      return !!filter.from || !!filter.to;
  }
}

/** The column's values with how many rows carry each - the most common first, then by name. */
export function distinctValues(cells: readonly string[]): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const cell of cells) counts.set(cell, (counts.get(cell) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "he"));
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isDayOrNull = (value: unknown): value is string | null => value === null || (typeof value === "string" && DAY.test(value));

function parseFilter(raw: unknown): HeaderFilterValue | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === "values") {
    return Array.isArray(raw.values) && raw.values.every((v) => typeof v === "string") ? { kind: "values", values: [...raw.values] } : null;
  }
  if (raw.kind === "text") return typeof raw.text === "string" ? { kind: "text", text: raw.text } : null;
  if (raw.kind === "date") return isDayOrNull(raw.from) && isDayOrNull(raw.to) ? { kind: "date", from: raw.from, to: raw.to } : null;
  return null;
}

/**
 * The filters a browser tab remembered, kept only where they still fit: a column the table still filters, of the
 * same kind, a well-formed active value, one per column. Anything else is dropped - a stale filter must never hide
 * rows nobody can see why.
 */
export function cleanStoredFilters(
  raw: unknown,
  kinds: Readonly<Record<string, HeaderFilterKind>>,
): { id: string; value: HeaderFilterValue }[] {
  if (!Array.isArray(raw)) return [];
  const out: { id: string; value: HeaderFilterValue }[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.id !== "string") continue;
    const kind = Object.prototype.hasOwnProperty.call(kinds, entry.id) ? kinds[entry.id] : undefined;
    const value = parseFilter(entry.value);
    if (!kind || !value || value.kind !== kind || !isActiveFilter(value)) continue;
    if (out.some((f) => f.id === entry.id)) continue;
    out.push({ id: entry.id, value });
  }
  return out;
}

const printDay = (day: string): string => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;

/** What a filter chip says after the column's name: "חדש, אין מענה", "“samnon”", "01.10.2026 – 31.10.2026". */
export function filterSummary(filter: HeaderFilterValue, label?: (value: string) => string): string {
  switch (filter.kind) {
    case "values": {
      const names = filter.values.map((v) => label?.(v) ?? (v === "" ? EMPTY_LABEL : v));
      const shown = names.slice(0, SUMMARY_VALUES).join(", ");
      return names.length > SUMMARY_VALUES ? `${shown} +${names.length - SUMMARY_VALUES}` : shown;
    }
    case "text":
      return `“${filter.text.trim()}”`;
    case "date":
      if (filter.from && filter.to) return `${printDay(filter.from)} – ${printDay(filter.to)}`;
      return filter.from ? `from ${printDay(filter.from)}` : `until ${printDay(filter.to ?? "")}`;
  }
}

/**
 * Rows an edit took out of a filtered list: shown before, still in the data, shown no more. (A row that left the
 * data - deleted, handed to another rep - is not news for the filter.)
 */
export function rowsLeftFilter(shownBefore: readonly string[], shownNow: readonly string[], allNow: readonly string[]): string[] {
  const now = new Set(shownNow);
  const all = new Set(allNow);
  return shownBefore.filter((id) => !now.has(id) && all.has(id));
}
