/**
 * The model every tours spreadsheet shares - the departures / pricing sheet
 * (components/tours/pricing) and the flights sheet (components/tours/flights):
 * what a column is, what the text typed or pasted into a cell means, how a
 * value is shown, and which cells changed. Pure: no I/O, no React. The grid
 * that draws it is ./sheet-grid.tsx.
 *
 * An edit is kept as the new value of a cell; Save sends, per row, every
 * changed cell with the value the sheet showed before (`before`), so the server
 * can skip a row someone else changed in the meantime.
 */
import { fmtDate, fmtInstant, formatNumber, isoToJerusalemLocal, jerusalemLocalToIso, parsePrice } from "@/lib/tours/format";

export type SheetValue = string | number | boolean | null | string[];

/** The cells of one row that changed: the value the sheet showed, and the new one. */
export interface SheetRowChange {
  id: string;
  cells: Record<string, { before: SheetValue; after: SheetValue }>;
}

export interface SheetOption {
  value: string;
  label: string;
}

export type SheetKind =
  | "readonly"
  | "price"
  | "int"
  | "money"
  | "bool"
  | "choice"
  | "labels"
  /** An instant, typed and shown in Israel time. */
  | "datetime"
  /** A wall-clock time with no zone (a flight's local departure): "2026-07-03T06:10". */
  | "localtime"
  /** A day: "2026-07-03". */
  | "date"
  | "text";

export interface SheetColumn<View extends string = string> {
  key: string;
  label: string;
  /** A longer name for the header's tooltip. */
  title?: string;
  kind: SheetKind;
  views: View[];
  /** Width in px. */
  width: number;
  /** Longest text kept (text columns). */
  max?: number;
  /** Lowest and highest number (int / money columns). */
  min?: number;
  top?: number;
  /** choice: the fixed list. A column whose list depends on the row has none - the sheet passes the row's list. */
  options?: readonly SheetOption[];
  /** choice: an empty cell is a value of its own (null). */
  nullable?: boolean;
  /** choice: what the empty choice is called in the list ("Main itinerary", "No season"). */
  nullLabel?: string;
  /** labels: the most one cell holds. */
  maxLabels?: number;
  /** text: kept in upper case (airport and airline codes). */
  upper?: boolean;
  /** text: an exact length (an airport code is 3 letters). */
  exact?: number;
  /** text / int: the cell may not be left empty. */
  required?: boolean;
  /** Left out of Set for Selected (a value that makes sense one row at a time). */
  noBulk?: boolean;
}

export const isEditable = (c: SheetColumn) => c.kind !== "readonly";
export const NUMERIC_KINDS = new Set<SheetKind>(["price", "money", "int"]);

// ---------------------------------------------------------------- reading what was typed
export type Parsed = { value: SheetValue } | { error: string };

const TRUE_WORDS = new Set(["1", "yes", "y", "true", "v", "x", "✓", "כן", "on"]);
const FALSE_WORDS = new Set(["", "0", "no", "n", "false", "לא", "off", "-"]);

const two = (n: string) => n.padStart(2, "0");
const loose = (s: string) => s.trim().toLowerCase().replace(/[\s_]+/g, "_");

/** "2026-07-03", "03/07/2026" or "3.7.26" -> "2026-07-03"; null when it is not a day. */
export function parseDay(text: string): string | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const il = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/.exec(text);
  let y: string, m: string, d: string;
  if (iso) [, y, m, d] = iso;
  else if (il) {
    [, d, m, y] = il;
    if (y.length === 2) y = `20${y}`;
  } else return null;
  const day = `${y}-${two(m)}-${two(d)}`;
  const at = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === day ? day : null;
}

/** "2026-07-03 05:30", "2026-07-03T05:30" or "03/07/2026 05:30" -> "2026-07-03T05:30"; null when it is not a time. */
export function parseLocalTime(text: string): string | null {
  const m = /^(.+?)[ T]+(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text);
  if (!m) return null;
  const day = parseDay(m[1].trim());
  if (!day || Number(m[2]) > 23 || Number(m[3]) > 59) return null;
  return `${day}T${two(m[2])}:${m[3]}`;
}

/**
 * What the text typed or pasted into a cell means, or why it means nothing.
 * `options` is the list of a choice column whose list depends on the row.
 */
export function parseCell(col: SheetColumn, raw: string, options?: readonly SheetOption[]): Parsed {
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
      if (text === "") return col.required ? { error: "Can't be empty" } : { value: null };
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
    case "choice": {
      const list = options ?? col.options ?? [];
      if (text === "") return col.nullable ? { value: null } : { error: `One of: ${list.map((o) => o.label).join(", ")}` };
      const t = loose(text);
      const found = list.find((o) => o.value === text || loose(o.value) === t || loose(o.label) === t);
      if (found) return { value: found.value };
      return { error: list.length ? `One of: ${list.map((o) => o.label).join(", ")}` : "Nothing to choose from on this row" };
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
      const most = col.maxLabels ?? 6;
      if (labels.length > most) return { error: `Up to ${most} labels` };
      return { value: labels };
    }
    case "datetime": {
      if (text === "") return { value: null };
      const local = parseLocalTime(text);
      const at = local ? jerusalemLocalToIso(local) : null;
      return at ? { value: at } : { error: "A date and time, e.g. 2026-07-03 05:30" };
    }
    case "localtime": {
      if (text === "") return col.nullable ? { value: null } : { error: "A date and time, e.g. 2026-07-03 05:30" };
      const local = parseLocalTime(text);
      return local ? { value: local } : { error: "A date and time, e.g. 2026-07-03 05:30" };
    }
    case "date": {
      if (text === "") return { value: null };
      const day = parseDay(text);
      return day ? { value: day } : { error: "A date, e.g. 2026-07-03 or 03/07/2026" };
    }
    case "text": {
      if (text === "") return col.required ? { error: "Can't be empty" } : { value: null };
      if (col.max && text.length > col.max) return { error: `Up to ${col.max} characters` };
      if (col.exact && text.length !== col.exact) return { error: `${col.exact} characters` };
      return { value: col.upper ? text.toUpperCase() : text };
    }
  }
}

/** The text a cell opens with for editing. */
export function editText(col: SheetColumn, value: SheetValue): string {
  if (value === null || value === undefined) return "";
  if (col.kind === "labels" && Array.isArray(value)) return value.join(", ");
  if (col.kind === "datetime" && typeof value === "string") return isoToJerusalemLocal(value).replace("T", " ");
  if (col.kind === "localtime" && typeof value === "string") return value.slice(0, 16).replace("T", " ");
  if (col.kind === "bool") return value ? "yes" : "no";
  return String(value);
}

/** "2026-07-03T06:10" -> "03.07.26 06:10". */
export const fmtLocalTime = (value: string): string => `${fmtDate(value.slice(0, 10))} ${value.slice(11, 16)}`;

/** The text a cell shows. */
export function displayText(col: SheetColumn, value: SheetValue, options?: readonly SheetOption[]): string {
  if (value === null || value === undefined) return "";
  switch (col.kind) {
    case "price":
    case "money":
      return typeof value === "number" ? formatNumber(value) : "";
    case "bool":
      return value ? "✓" : "";
    case "choice":
      return (options ?? col.options ?? []).find((o) => o.value === value)?.label ?? String(value);
    case "labels":
      return Array.isArray(value) ? value.join(", ") : "";
    case "datetime":
      return typeof value === "string" ? fmtInstant(value) : "";
    case "localtime":
      return typeof value === "string" ? fmtLocalTime(value) : "";
    case "date":
      return typeof value === "string" ? fmtDate(value) : "";
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

export type SheetEdits = Record<string, Record<string, SheetValue>>;

/** The changes to send: every edited cell whose value differs from the row as loaded. */
export function changesOf<R>(
  rows: Map<string, R>,
  edits: SheetEdits,
  cellValue: (row: R, key: string) => SheetValue,
): SheetRowChange[] {
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

/** What a save answers: the rows saved whole, the rows not saved (or saved in part) with the reason. */
export interface SheetSaveResult {
  saved: string[];
  skipped: { id: string; code: string; reason: string }[];
  /** Saved, but worth a look (e.g. on the site with no season). */
  notes?: { code: string; note: string }[];
}
