// Helpers every competitor crawler shares. Pure, no "@/" imports, no DB - the fixture
// scripts import the parsers under plain `node --experimental-strip-types`.
//
// IMPORT RULE for everything under competitor-scrapers/ (final review, M9): a VALUE import
// must be a relative path with an explicit ".ts" extension (node's type stripper resolves no
// aliases); a TYPE-ONLY import may use "@/" since it is erased before node ever sees it. And
// never value-import a module that drags a heavy runtime in - which is why the UA list sits in
// its own `../ua.ts` rather than being read from `../browser.ts` (playwright + chromium).
import { parseHTML } from "linkedom";
import type { Currency } from "../../../types/price-light.types";
import { UAS } from "../ua.ts";

/**
 * How much of a detail page's text is stored. Was 2000 per site, which cut OnTour's Celine Dion page
 * mid-way through the ticket block - and the contents the /price-light comparison reads back out
 * (lib/services/offer-detail.ts: airline, flight times, hotel, board, seat) sit at the END of these
 * pages. Same ceiling the AI judge already reads (`AI_DETAIL_TEXT_MAX`).
 */
export const DETAIL_TEXT_MAX = 6_000;

/**
 * The page says a checked bag is NOT included ("לא כולל מזוודה", "ללא מזוודות", "הטיסה אינה כוללת
 * כבודה"). Every crawler must test this BEFORE its "מזוודה/כבודה means included" check: a bare
 * substring test read the exclusion sentence as inclusion and handed that listing a $120 BAG_USD
 * discount in `normalize()` - on exactly the pages that are cheap because the bag is extra.
 */
export function bagExcluded(text: string): boolean {
  return /(ללא|לא\s*כולל|לא\s*כלול|אינו\s*כולל|אינה\s*כוללת|אינן\s*כוללות|אינם\s*כוללים)[^.]{0,20}(מזוודו?ת?|כבודה)/.test(text);
}

const ACCEPT_LANGUAGE = "he-IL,he;q=0.9,en-US;q=0.8";
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

/** Stealth headers for a plain fetch - UA rotation + Israeli Accept-Language, no referer. */
export function stealthHeaders(): Record<string, string> {
  return { "User-Agent": pick(UAS), "Accept-Language": ACCEPT_LANGUAGE };
}

export function doc(html: string): Document {
  return parseHTML(html).document as unknown as Document;
}

const HE_MONTHS: Record<string, number> = {
  "ינואר": 1, "פברואר": 2, "מרץ": 3, "אפריל": 4, "מאי": 5, "יוני": 6,
  "יולי": 7, "אוגוסט": 8, "ספטמבר": 9, "אוקטובר": 10, "נובמבר": 11, "דצמבר": 12,
};

/** ISO date, or null when calendar-invalid ("31.02.2026" - `Date` would roll it over silently). */
export function isoOrNull(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "26/10/2026" | "26.10.26" | "26 באוקטובר 2026" -> "2026-10-26"; null if calendar-invalid. */
export function parseHeDate(text: string): string | null {
  const t = text.trim();
  const dmy = t.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (dmy) {
    const y = dmy[3].length === 2 ? Number(`20${dmy[3]}`) : Number(dmy[3]);
    return isoOrNull(y, Number(dmy[2]), Number(dmy[1]));
  }
  const he = t.match(/(\d{1,2})\s+ב?([א-ת]+)\s+(\d{4})/);
  if (he && HE_MONTHS[he[2]]) return isoOrNull(Number(he[3]), HE_MONTHS[he[2]], Number(he[1]));
  return null;
}

/** "החל מ-₪2,990 לאדם" | "1,349" | "€789" -> 2990 | 1349 | 789 */
export function parsePrice(text: string): number | null {
  const m = text.replace(/[,\s]/g, "").match(/(\d{3,6})/);
  return m ? Number(m[1]) : null;
}

export function currencyFromSymbol(sym: string): Currency | null {
  const s = sym.trim();
  if (s.includes("€")) return "EUR";
  if (s.includes("£")) return "GBP";
  if (s.includes("₪")) return "ILS";
  if (s.includes("$")) return "USD";
  return null;
}

/** Whole nights between two ISO days; "unknown" unless both are valid and return > depart. */
export function nightsBetween(depart: string | null, ret: string | null): number | "unknown" {
  if (!depart || !ret) return "unknown";
  const diff = Math.round((Date.parse(`${ret}T00:00:00Z`) - Date.parse(`${depart}T00:00:00Z`)) / 86_400_000);
  return Number.isFinite(diff) && diff > 0 ? diff : "unknown";
}

const DEFAULT_NOISE = "script, style, noscript, input, select, option, label";

/** Text of `el` with noise nodes removed and whitespace collapsed ("" for null). */
export function flatText(el: Element | null, noise: string = DEFAULT_NOISE): string {
  if (!el) return "";
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(noise).forEach((n) => n.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Every non-empty text node under `el`, trimmed, in document order - one "line" per node. */
export function textLines(el: Element): string[] {
  const out: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3 /* TEXT_NODE */) {
      const t = (n.textContent ?? "").replace(/\s+/g, " ").trim();
      if (t) out.push(t);
      return;
    }
    const tag = (n as Element).tagName?.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "noscript") return;
    n.childNodes.forEach(walk);
  };
  walk(el);
  return out;
}

export function absoluteUrl(href: string, base: string): string {
  if (/^https?:\/\//.test(href)) return href;
  const origin = new URL(base).origin;
  return `${origin}${href.startsWith("/") ? "" : "/"}${href}`;
}
