/**
 * The marks staff put on a tour's main attractions (Daniel, 10.11.2026: "להדגיש אטרקציות ספציפיות בצבע (לבחירתי)", and a
 * country "שכל האטרקציות אחריו יהיו מאותה מדינה. המדינה צריך להיות מודגש בכחול"). The list stays a list of words
 * (`tours.packages.attractions`, a season's too); a line may open with a mark:
 *   "[[country]] אנגליה"     - a country: the attractions after it, until the next country, are in it;
 *   "[[#E11D48]] מגדל אייפל" - an attraction drawn in that colour.
 * The site reads them with its lib/attractions.ts (mega-family) - change both together.
 */

export interface AttractionLine {
  text: string;
  country: boolean;
  /** "#RRGGBB" or null. A country has none. */
  color: string | null;
}

const MARK = /^\s*\[\[(country|#[0-9a-fA-F]{6})\]\]\s*/;

/** The colours offered for an attraction, besides any colour typed in. */
export const ATTRACTION_COLORS: { label: string; value: string }[] = [
  { label: "Red", value: "#DC2626" },
  { label: "Orange", value: "#EA580C" },
  { label: "Gold", value: "#CA8A04" },
  { label: "Green", value: "#16A34A" },
  { label: "Teal", value: "#0D9488" },
  { label: "Blue", value: "#0059AA" },
  { label: "Purple", value: "#7C3AED" },
  { label: "Pink", value: "#DB2777" },
];

export function readAttraction(line: string): AttractionLine {
  const m = MARK.exec(line);
  if (!m) return { text: line, country: false, color: null };
  const text = line.slice(m[0].length);
  return m[1] === "country" ? { text, country: true, color: null } : { text, country: false, color: m[1].toUpperCase() };
}

export function writeAttraction(a: AttractionLine): string {
  if (a.country) return `[[country]] ${a.text}`;
  if (a.color && /^#[0-9a-fA-F]{6}$/.test(a.color)) return `[[${a.color.toUpperCase()}]] ${a.text}`;
  return a.text;
}

/** The words of a line as a person reads them, with what its mark means ("אנגליה (country)"). */
export function attractionLabel(line: string): string {
  const a = readAttraction(line);
  return a.country ? `${a.text.trim()} (country)` : a.text.trim();
}
