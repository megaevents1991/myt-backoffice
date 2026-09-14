/**
 * What a package actually IS - the partner's format (2026-09-14): "טיסות: אל על עם מזוודה ישיר
 * 16-20 | מלון: שם מלון כולל ארוחת בוקר או ללא | סוג כרטיס".
 *
 * A price with no contents is half an answer: "$1,349 vs our $1,420" reads as dear until you see
 * their trolley-only El Al against our checked bag. Every competitor detail page already says all
 * of it in plain Hebrew; this reads it back out, per site, with no AI.
 *
 * Pure - text in, fields out, no DB, no fetch - so `scripts/price-light-selftest.ts` and the
 * fixture checks exercise it under plain node. It parses the STORED `detail_text`, not the live
 * page, so improving a parser here re-describes every listing already crawled.
 * `formatOfferLines` is shared with OUR side (lib/services/our-offer-detail.ts) so both columns of
 * the comparison are written in the same words.
 */
import type {
  Board, CompetitorKey, ExtractedAttrs, FlightLeg, OfferDetail, OfferFlight, OfferHotel, OfferLines,
} from "@/types/price-light.types";

// ---- airlines -------------------------------------------------------------------------------
/** IATA code -> the name staff say out loud. Our side gets codes from Amadeus; Golasso prints them. */
const AIRLINE_CODES: Record<string, string> = {
  LY: "אל על", "6H": "ישראייר", IZ: "ארקיע", W6: "וויז אייר", W4: "וויז אייר", "5W": "וויז אייר", FR: "ריינאייר",
  U2: "איזיג'ט", UX: "אייר אירופה", VY: "ווילינג", A3: "אג'יאן", BZ: "בלו בירד", LH: "לופטהנזה", TK: "טורקיש",
  AZ: "ITA", AF: "אייר פראנס", BA: "בריטיש איירווייז", KL: "KLM", LX: "סוויס", OS: "אוסטריאן", SN: "בריסל איירליינס",
  HV: "טרנסאוויה", TO: "טרנסאוויה", EW: "יורווינגס", DE: "קונדור", PC: "פגסוס", RO: "טארום", FB: "בולגריה אייר",
  OU: "קרואטיה איירליינס", LO: "LOT", SK: "SAS", AY: "פינאייר", IB: "איבריה", TP: "TAP", EI: "אר לינגוס",
  AA: "אמריקן", DL: "דלתא", UA: "יונייטד איירליינס", AC: "אייר קנדה", EK: "אמירייטס", EY: "איתיחאד", FZ: "פליי דובאי",
};

/** Written names, Hebrew and Latin, as the sites print them. */
const AIRLINE_NAMES: [RegExp, string][] = [
  [/אל[\s-]?על|EL[\s-]?AL/i, "אל על"],
  [/ישראייר|ISRAIR/i, "ישראייר"],
  [/ארקיע|ARKIA/i, "ארקיע"],
  [/וויז\s?אייר|WIZZ/i, "וויז אייר"],
  [/ריי?נאייר|RYANAIR/i, "ריינאייר"],
  [/איזי\s?ג'?יט|EASYJET/i, "איזיג'ט"],
  [/אייר\s?אירופה|AIR\s?EUROPA/i, "אייר אירופה"],
  [/ווילינג|וואלינג|VUELING/i, "ווילינג"],
  [/אג'?יאן|AEGEAN/i, "אג'יאן"],
  [/בלו\s?בירד|BLUE\s?BIRD/i, "בלו בירד"],
  [/לופטהנזה|LUFTHANSA/i, "לופטהנזה"],
  [/טורקיש|TURKISH/i, "טורקיש"],
  [/אייר\s?פראנס|AIR\s?FRANCE/i, "אייר פראנס"],
  [/בריטיש|BRITISH\s?AIRWAYS/i, "בריטיש איירווייז"],
  [/סוויס|SWISS/i, "סוויס"],
  [/אוסטריאן|AUSTRIAN/i, "אוסטריאן"],
  [/פגסוס|PEGASUS/i, "פגסוס"],
  [/חברת\s*לוט|LOT\s*POLISH/i, "LOT"],
];

export function airlineFromCode(code: string | null | undefined): string | null {
  const c = (code ?? "").trim().toUpperCase();
  if (!c) return null;
  return AIRLINE_CODES[c] ?? c;
}

export function airlineFromText(text: string): string | null {
  for (const [re, name] of AIRLINE_NAMES) if (re.test(text)) return name;
  return null;
}

// ---- shared wording -------------------------------------------------------------------------
const TIME = "(\\d{1,2}:\\d{2})";

export function boardFrom(text: string | null | undefined): Board | null {
  const t = text ?? "";
  if (/ללא\s*ארוחת\s*בוקר|לא\s*כולל\s*ארוחת\s*בוקר|לינה\s*בלבד|room\s*only|nomeal/i.test(t)) return "room_only";
  if (/ארוחת\s*בוקר|breakfast/i.test(t)) return "breakfast";
  return null;
}

/**
 * "כבודה מלאה" / "כולל מזוודה 23 ק"ג" / "טרולי בלבד" / "תיק גב בלבד" - or null when the text never
 * says. Hand it the FLIGHT sentence only: "לינה בלבד" further down would otherwise read as a bag rule.
 */
export function bagFrom(text: string): string | null {
  if (/כבודה\s*מלאה/.test(text)) return "כבודה מלאה";
  // Negations first ("לא כולל מזוודה" contains "מזוודה") - same rule as competitor-scrapers/shared.ts bagExcluded.
  if (/(ללא|לא\s*כולל|לא\s*כלול|אינו\s*כולל|אינה\s*כוללת|אינן\s*כוללות)[^.]{0,20}(מזוודו?ת?|כבודה)|טרולי\s*בלבד/.test(text)) return "טרולי בלבד";
  const suitcase = text.match(/מזוודה[^.]{0,30}?(\d{2})\s*(?:ק["״]?ג|קילו)/);
  if (suitcase) return `כולל מזוודה ${suitcase[1]} ק"ג`;
  // "כוללת טרולי וכבודה" = a checked bag too; a bare "כבודת יד" is cabin only.
  if (/מזוודה|טרולי\s*וכבודה|כבודה\s*(?:רשומה|לבטן)/.test(text)) return "כולל מזוודה";
  if (/טרולי|כבודת\s*יד/.test(text)) return "טרולי בלבד";
  if (/תיק\s*גב/.test(text)) return "תיק גב בלבד";
  return null;
}

const HE_NUMBERS: Record<string, number> = { שני: 2, שניים: 2, שלוש: 3, שלושה: 3, ארבע: 4, ארבעה: 4, חמש: 5, חמישה: 5 };

function starsFrom(token: string): number | null {
  const n = Number(token);
  if (Number.isInteger(n) && n >= 1 && n <= 5) return n;
  return HE_NUMBERS[token] ?? null;
}

/** A package that bundles several fixtures - the one line every Golasso multi-game page opens with. */
export function isMultiMatchText(text: string | null | undefined): boolean {
  return /חבילה\s*מרובת\s*משחקים/.test(text ?? "");
}

const MAP_COLOURS = "כתום|ירוק|הירוק|צהוב|אדום|תכלת|כחול|סגול|אפור|ורוד|שחור|לבן|זהב|חום|בורדו|טורקיז";

function clean(s: string | null | undefined): string | null {
  const t = (s ?? "").replace(/\s+/g, " ").replace(/^[\s,.;:–-]+|[\s,.;:–-]+$/g, "");
  return t.length > 0 ? t : null;
}

// ---- per site -------------------------------------------------------------------------------
/**
 * LiveEvents `/package/` pages (flat text, blocks glued with no spaces):
 * "טיסות יציאה 08.10.2026אלעלתל אביב17:15מדריד21:35 חזרה 11.10.2026אלעלמדריד22:50תל אביב04:25 (1+)
 *  כבודת יד - ... ללא מזוודותכלול בחבילה ... מלוןGran Versallesמלון ברמת 4 כוכבים במדריד על בסיס לינה
 *  וארוחת בוקר ...כלול בחבילה ... כרטיס להופעה...09.10ישיבה יציע עליוןכתום במפהכלול בחבילה"
 * The first option each block marks "כלול בחבילה" is the one in the price.
 */
function parseLiveEvents(t: string): OfferDetail {
  const start = t.indexOf("טיסות");
  const flightText = start >= 0 ? t.slice(start, start + 900) : "";
  const leg = (label: string) => {
    const m = flightText.match(new RegExp(`${label}\\s*\\d{1,2}\\.\\d{1,2}\\.\\d{2,4}(.{0,40}?)${TIME}\\D{1,40}?${TIME}`));
    return m ? { airlineText: m[1], leg: { depart: m[2], arrive: m[3] }, end: (m.index ?? 0) + m[0].length } : null;
  };
  const out = leg("יציאה");
  const back = leg("חזרה");
  let flight: OfferFlight | null = null;
  let afterFlight = 0;
  if (out || back) {
    const legsEnd = back?.end ?? out?.end ?? 0;
    const included = flightText.indexOf("כלול בחבילה", legsEnd);
    const bagText = flightText.slice(legsEnd, included > 0 ? included : legsEnd + 250);
    flight = {
      airline: airlineFromText(`${out?.airlineText ?? ""} ${back?.airlineText ?? ""}`),
      direct: !/קונקשן|עצירה|חניית\s*ביניים/.test(flightText),
      bag: bagFrom(bagText),
      out: out?.leg ?? null,
      back: back?.leg ?? null,
    };
    afterFlight = start + (included > 0 ? included : legsEnd);
  }

  const rest = t.slice(afterFlight);
  const hotelMatch = rest.match(/מלון\s*(.{2,80}?)\s*מלון\s*ברמת\s*(\d)\s*כוכבים(.{0,160}?)כלול\s*בחבילה/);
  const hotel: OfferHotel | null = hotelMatch
    ? { name: clean(hotelMatch[1]), stars: Number(hotelMatch[2]), board: boardFrom(hotelMatch[3]) }
    : null;

  let ticket: string | null = null;
  const ticketStart = rest.search(/כרטיס(?:ים)?\s*(?:להופעה|למשחק|כניסה)/);
  if (ticketStart >= 0) {
    const block = rest.slice(ticketStart, ticketStart + 600);
    const m = block.match(/\d{1,2}\.\d{1,2}\s*(.{2,60}?)\s*כלול\s*בחבילה/);
    if (m) ticket = clean(m[1].replace(new RegExp(`(?:${MAP_COLOURS})\\s*במפה$`), ""));
  }
  return { flight, hotel, ticket, multiMatch: false };
}

/**
 * Golasso `/pdetails/<id>`: a prose summary ("טיסת סדיר ... ע"י מובילת התעופה אלעל. טיסות אלעל כוללות
 * טרולי עד 8 קילו 2.שלושה לילות במלון ROYAL NATIONAL ברמת 3 כוכבים ... על בסיס לינה בלבד. ... במסגרת
 * קטגוריה 3 מאחורי השער") plus a flight table glued into one run:
 * "הלוךIsrael- TLVLondon Luton - LTNLY311EL-AL11.09.2604:5008:15חזור...LY314EL-AL14.09.2618:0000:55".
 */
function parseGolasso(t: string): OfferDetail {
  const tableAt = t.indexOf("פרטי טיסה");
  const table = tableAt >= 0 ? t.slice(tableAt) : "";
  // Rows print as "LY311EL-AL11.09.26 04:50 08:15", "IZ911 Arkia11.09.26..." or "6H383Israir18.09.26...".
  const tableLeg = (label: string, until: string | null) => {
    const from = table.indexOf(label);
    if (from < 0) return null;
    const to = until ? table.indexOf(until, from + label.length) : -1;
    const seg = table.slice(from, to > from ? to : from + 300);
    const rows = [...seg.matchAll(/([A-Z0-9]{2})(\d{2,4})\s*[A-Za-z][A-Za-z\s-]*?\d{2}\.\d{2}\.\d{2}(\d{2}:\d{2})(\d{2}:\d{2})/g)];
    if (rows.length === 0) return null;
    return { code: rows[0][1], rows: rows.length, leg: { depart: rows[0][3], arrive: rows[rows.length - 1][4] } };
  };
  const out = tableLeg("הלוך", "חזור");
  const back = tableLeg("חזור", null);
  const prose = tableAt >= 0 ? t.slice(0, tableAt) : t;
  // The numbered list's flight item only ("1.טיסה שכר ישירה ... לכל נוסע2.ארבעה לילות") - its bag
  // wording must not borrow "לינה בלבד" from the hotel item that follows.
  const flightAt = prose.search(/טיס(?:ה|ת|ות)/);
  const flightItem = flightAt >= 0 ? prose.slice(flightAt).split(/\s?\d\.(?!\d)/)[0] : "";
  const flight: OfferFlight | null = out || back || flightItem
    ? {
        airline: airlineFromText(flightItem) ?? airlineFromCode(out?.code ?? back?.code),
        direct: out || back
          ? (out?.rows ?? 1) === 1 && (back?.rows ?? 1) === 1
          : /ישיר/.test(flightItem) ? true : null,
        bag: bagFrom(flightItem),
        out: out?.leg ?? null,
        back: back?.leg ?? null,
      }
    : null;

  const h = prose.match(/במלון\s+(.{2,60}?)\s+ברמת\s+(\d|\S+)\s*כוכבים(.{0,80}?)(?:\.|\d\.)/);
  const hotel: OfferHotel | null = h ? { name: clean(h[1]), stars: starsFrom(h[2]), board: boardFrom(h[3]) } : null;

  // The booking widget's "(כלול בחבילה)" choice is what the price buys; the prose can disagree
  // (#7: prose "קטגוריה 4", widget "קטגוריה 3 (כלול בחבילה)"). The prose only adds its description
  // when it speaks about the same category.
  const chosen = t.match(/(קטגוריה\s*(\d+))\s*\(כלול\s*בחבילה\)/);
  let ticket: string | null = null;
  if (chosen) {
    const said = prose.match(new RegExp(`קטגוריה\\s*${chosen[2]}\\s+([^.(,\\d]{3,30})`));
    ticket = clean(`${chosen[1]} ${said?.[1] ?? ""}`);
  } else {
    ticket = clean(prose.match(/(קטגוריה\s*\d+[^.(\d]{0,30})/)?.[1]);
  }
  return { flight, hotel, ticket, multiMatch: isMultiMatchText(t) };
}

/**
 * OnTour performer pages: "יציאה 17.09.2026 שעת המראה 10:00 שעת נחיתה 13:50 חזרה 20.09.2026 שעת המראה 07:35
 * שעת נחיתה 13:00 טיסות ישירות לפריז עם חברת התעופה אל-על כולל כבודה מלאה ... 3 לילות במלון 3* BEST
 * WESTERN PLUS QUARTIER LATIN PANTHEON כולל ארוחת בוקר ... ישיבה באזור הירוק במפה – מחיר בסיס".
 */
function parseOnTour(t: string): OfferDetail {
  // "שעת המראה 10:00 שעת נחיתה 13:50" or "המראה בשעה 5:40 ונחיתה בשעה 08:30".
  const leg = (label: string): FlightLeg | null => {
    const m = t.match(new RegExp(
      `${label}\\s*[\\d.]+\\s*(?:שעת\\s*המראה|המראה\\s*בשעה)\\s*${TIME}\\s*(?:שעת\\s*נחיתה|ונחיתה\\s*בשעה)\\s*${TIME}`,
    ));
    return m ? { depart: m[1], arrive: m[2] } : null;
  };
  const out = leg("יציאה");
  const back = leg("חזרה");
  const sentence = t.match(/טיס(?:ות|ה)\s+[^.]{0,160}/)?.[0] ?? "";
  const flight: OfferFlight | null = out || back || sentence
    ? {
        airline: airlineFromText(sentence),
        direct: /טיסות\s*ישירות|טיסה\s*ישירה/.test(t) ? true : /עצירה|קונקשן/.test(sentence) ? false : null,
        bag: bagFrom(sentence),
        out,
        back,
      }
    : null;

  // "3 לילות במלון 3* BEST WESTERN ... כולל ארוחת בוקר", "במלון 3* מרכזי, MOXY PARIS BASTILLE ...",
  // "במלון 4 כוכבים ממוזג ומרכזי Leonardo Hotel ... ע"ב לינה וארוחת בוקר", "במלון ספא 4* Galaxy Hotel, ע"ב ...".
  // The name is the Latin run; Hebrew adjectives before it are skipped.
  const h = t.match(new RegExp(
    "לילות\\s*במלון\\s*(?:ספא\\s*|בוטיק\\s*)?(\\d)\\s*(?:\\*|כוכבים)\\s*(?:[\\u05D0-\\u05EA,]+\\s+){0,3}?" +
    "([A-Za-z][A-Za-z0-9 .'&-]{2,60}?)\\s*,?\\s*" +
    "(כולל\\s*ארוחת\\s*בוקר|ללא\\s*ארוחת\\s*בוקר|ע[\"״]?ב\\s*לינה\\s*(?:וארוחת\\s*בוקר|בלבד)|על\\s*בסיס\\s*לינה\\s*(?:בלבד|וארוחת\\s*בוקר)|לינה\\s*בלבד)",
  ));
  const hotel: OfferHotel | null = h ? { name: clean(h[2]), stars: Number(h[1]), board: boardFrom(h[3]) } : null;

  // Base seat first: "ישיבה באזור הירוק במפה – מחיר בסיס", then "כרטיס עמידה קדמית מול הבמה (ורוד במפה)" /
  // "ישיבה ביציע התחתון (צהוב במפה)" - the first such line is the base; upgrades follow it.
  const tk = t.match(/(באזור\s+\S+)\s*במפה\s*[–-]\s*(?:מחיר\s*בסיס|במחיר\s*החבילה)/)
    ?? t.match(new RegExp(`((?:ישיבה|עמידה)\\s+[^(.]{2,40}?)\\s*\\(\\s*(?:${MAP_COLOURS})\\s*במפה\\s*\\)`))
    ?? t.match(/כרטיס\s*כניסה\s*להופעה[^.]{0,60}?(באזור\s+\S+)/);
  return { flight, hotel, ticket: clean(tk?.[1]), multiMatch: false };
}

/** Whatever the page's boolean markers already said - the floor every parser falls back to. */
function fromAttrs(attrs: Partial<ExtractedAttrs> | null | undefined): OfferDetail {
  const a = attrs ?? {};
  const direct = typeof a.direct_flight === "boolean" ? a.direct_flight : null;
  const bag = a.bag_included === true ? "כולל מזוודה" : a.bag_included === false ? "טרולי בלבד" : null;
  const stars = typeof a.hotel_stars === "number" ? a.hotel_stars : null;
  const board: Board | null = a.breakfast === true ? "breakfast" : a.breakfast === false ? "room_only" : null;
  return {
    flight: direct != null || bag != null ? { airline: null, direct, bag, out: null, back: null } : null,
    hotel: stars != null || board != null ? { name: null, stars, board } : null,
    ticket: null,
    multiMatch: false,
  };
}

/** Field-wise: a parsed value wins, the attrs marker fills what the text did not say. */
function withFallback(parsed: OfferDetail, floor: OfferDetail): OfferDetail {
  const flight = parsed.flight || floor.flight
    ? {
        airline: parsed.flight?.airline ?? null,
        direct: parsed.flight?.direct ?? floor.flight?.direct ?? null,
        bag: parsed.flight?.bag ?? floor.flight?.bag ?? null,
        out: parsed.flight?.out ?? null,
        back: parsed.flight?.back ?? null,
      }
    : null;
  const hotel = parsed.hotel || floor.hotel
    ? {
        name: parsed.hotel?.name ?? null,
        stars: parsed.hotel?.stars ?? floor.hotel?.stars ?? null,
        board: parsed.hotel?.board ?? floor.hotel?.board ?? null,
      }
    : null;
  return { flight, hotel, ticket: parsed.ticket, multiMatch: parsed.multiMatch };
}

const PARSERS: Partial<Record<CompetitorKey, (text: string) => OfferDetail>> = {
  liveevents: parseLiveEvents,
  golasso: parseGolasso,
  ontour: parseOnTour,
};

export const EMPTY_OFFER: OfferDetail = { flight: null, hotel: null, ticket: null, multiMatch: false };

/**
 * A competitor listing's contents. ISSTA's detail page is a JS loader (its stored text is a tagline)
 * and LiveTickets is a ticket-only table, so those two describe only what `attrs` already knew.
 */
export function parseOfferDetail(
  competitor: CompetitorKey,
  detailText: string | null | undefined,
  attrs?: Partial<ExtractedAttrs> | null,
): OfferDetail {
  const parser = PARSERS[competitor];
  const text = (detailText ?? "").replace(/\s+/g, " ").trim();
  const parsed = parser && text.length > 0 ? parser(text) : EMPTY_OFFER;
  return withFallback(parsed, fromAttrs(attrs));
}

function legLine(label: string, leg: FlightLeg | null): string | null {
  if (!leg || (!leg.depart && !leg.arrive)) return null;
  return `${label} ${leg.depart ?? "?"}–${leg.arrive ?? "?"}`;
}

/** The three lines, in the partner's order and words. Unknown parts are left out, never shown as "?". */
export function formatOfferLines(d: OfferDetail): OfferLines {
  const f = d.flight;
  const flight = f
    ? [
        f.airline,
        f.direct === true ? "ישירה" : f.direct === false ? "עם עצירה" : null,
        f.bag,
        legLine("הלוך", f.out),
        legLine("חזור", f.back),
      ].filter(Boolean).join(" · ")
    : "";
  const h = d.hotel;
  const hotel = h
    ? [
        h.name,
        h.stars != null ? `${h.stars}★` : null,
        h.board === "breakfast" ? "כולל ארוחת בוקר" : h.board === "room_only" ? "ללא ארוחת בוקר" : null,
      ].filter(Boolean).join(" · ")
    : "";
  return { flight: flight || null, hotel: hotel || null, ticket: clean(d.ticket) };
}
