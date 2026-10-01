/**
 * One-time import of the Mega Family company into the `tours` schema.
 * Spec: mega-family/docs/plans/MEGA-FAMILY-DATA-SPEC.md (sections 3 and 6).
 *
 * Sources (none of them is read again after go-live - this is not an integration):
 *   --content  mega-family/content            the site's JSON (pages, packages, taxonomies, ...)
 *   --sheet    the site-feed workbook (xlsx export of the Google Sheet)
 *   --flights  the flight operations workbook (FLIGHT_2026.xlsx)
 *
 *   npx tsx --env-file=.env.development.local scripts/import-mega-family.ts \
 *     --content ../mega-family/content --sheet <feed.xlsx> --flights <FLIGHT.xlsx> \
 *     [--year-from 2026] [--with-flights] [--overwrite] [--report <file.json>] [--apply]
 *
 * Dry-run is the default: it parses everything, prints the counts and the
 * exceptions, and writes nothing. `--apply` writes.
 *
 * Re-runnable: rows are keyed by natural keys (slug / code + year / import_ref).
 * A second run inserts only what is missing; it never overwrites what was edited
 * in the backoffice unless `--overwrite` is passed.
 *
 * `--with-flights` is a separate switch on purpose: Mega Family flight blocks
 * share `public.flights` with Mega Events. Do not pass it against production
 * until every flights query in the backoffice is company-scoped.
 */
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { supabaseTyped } from "@/lib/supabase-server";
import type { Database, Json } from "@/types/database.types";

type Tours = Database["tours"]["Tables"];
type Pub = Database["public"]["Tables"];
type Row = Record<string, unknown>;

const COMPANY_SLUG = "mega-family";
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, fallback = "") => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const APPLY = flag("apply");
const OVERWRITE = flag("overwrite");
const WITH_FLIGHTS = flag("with-flights");
const YEAR_FROM = Number(opt("year-from", "2026"));
const CONTENT_DIR = opt("content");
const SHEET_FILE = opt("sheet");
const FLIGHTS_FILE = opt("flights");
const REPORT_FILE = opt("report", path.join(process.cwd(), "import-mega-family-report.json"));

const tours = supabaseTyped.schema("tours");
const exceptions: { kind: string; ref: string; detail: string }[] = [];
const note = (kind: string, ref: string, detail: string) => exceptions.push({ kind, ref, detail });

// ---------------------------------------------------------------- cell helpers
type Cell = string | number | boolean | Date | null;

function cell(v: ExcelJS.CellValue | undefined): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if ("result" in o) return cell(o.result as ExcelJS.CellValue);
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join("");
    if (typeof o.text === "string") return o.text;
    return null;
  }
  return v as string | number | boolean;
}

const str = (v: Cell): string => (v === null ? "" : v instanceof Date ? v.toISOString() : String(v)).trim();

function num(v: Cell): number | null {
  if (v === null || v === "" || v instanceof Date || typeof v === "boolean") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return String(v).trim() !== "" && Number.isFinite(n) && /\d/.test(String(v)) ? n : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Excel serial / Date / "d.m.yyyy" -> "yyyy-mm-dd". */
function isoDate(v: Cell): string | null {
  if (v === null || v === "") return null;
  if (v instanceof Date) {
    if (v.getUTCFullYear() < 1990) return null; // a time-only cell
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  }
  if (typeof v === "number") {
    if (v < 30000 || v > 70000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/.exec(String(v).trim());
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
}

/** Excel day fraction / Date / "HH:MM" -> "HH:MM". */
function hhmm(v: Cell): string | null {
  if (v === null || v === "") return null;
  if (v instanceof Date) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
  if (typeof v === "number") {
    const mins = Math.round((v % 1) * 1440);
    return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
  }
  const m = /(\d{1,2}):(\d{2})/.exec(String(v));
  return m ? `${pad(Number(m[1]))}:${m[2]}` : null;
}

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

const truthy = (v: Cell) => v === true || v === 1 || str(v) === "1" || str(v).toLowerCase() === "true";

/** Loose key for matching Hebrew names typed slightly differently in two files. */
const nameKey = (s: string) => s.replace(/["'`׳״’‘]/g, "").replace(/\s+/g, " ").trim();

const slugify = (s: string) =>
  s.trim().replace(/["'`׳״’‘().,/]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").toLowerCase();

async function workbook(file: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb;
}

const sheetByName = (wb: ExcelJS.Workbook, test: (name: string) => boolean) =>
  wb.worksheets.find((ws) => test(ws.name.trim()));

/** Rows of a sheet as objects keyed by the header row (trimmed header text). */
function keyedRows(ws: ExcelJS.Worksheet, headerRow: number): Record<string, Cell>[] {
  const headers: Record<number, string> = {};
  ws.getRow(headerRow).eachCell({ includeEmpty: false }, (c, col) => {
    const h = str(cell(c.value));
    if (h) headers[col] = h.replace(/\s+/g, "_");
  });
  const out: Record<string, Cell>[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const o: Record<string, Cell> = { _row: r };
    let any = false;
    for (const [col, h] of Object.entries(headers)) {
      const v = cell(row.getCell(Number(col)).value);
      if (v !== null && v !== "") any = true;
      o[h] = v;
    }
    if (any) out.push(o);
  }
  return out;
}

// ---------------------------------------------------------------- db helpers
const chunk = <T,>(rows: T[], size = 400) =>
  Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));

async function upsertTours<K extends keyof Tours>(table: K, rows: Tours[K]["Insert"][], onConflict: string) {
  if (!APPLY || rows.length === 0) return;
  for (const part of chunk(rows)) {
    const { error } = await tours
      .from(table)
      .upsert(part as never, { onConflict, ignoreDuplicates: !OVERWRITE, defaultToNull: false });
    if (error) throw new Error(`${String(table)}: ${error.message}`);
  }
}

async function selectTours<K extends keyof Tours>(table: K, columns: string, companyId: string | null) {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    let q = tours.from(table).select(columns).range(from, from + 999);
    if (companyId) q = q.eq("company_id" as never, companyId as never);
    const { data, error } = await q;
    if (error) throw new Error(`${String(table)}: ${error.message}`);
    out.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const readJson = <T,>(name: string): T => JSON.parse(readFileSync(path.join(CONTENT_DIR, name), "utf8")) as T;

// ---------------------------------------------------------------- site JSON shapes (only what the import reads)
interface SiteTerm { id: number; kind: string; slug: string; name: string; descriptionHtml?: string; heroImages?: string[] }
interface SiteDeparture {
  productId: number | null; code: string; startDate?: string; endDate?: string; currency?: string; season?: string;
  status?: { label: string; tone: string } | null; tags?: string[]; soldOut?: boolean;
  discount?: { fixedPerPerson?: number; groundPct?: number; label?: string };
  flights?: { from?: string; to?: string }[];
}
interface SitePackage {
  id: number; slug: string; name: string; subtitle?: string; code?: string; brand?: string; template?: string;
  heroImage?: string; cardImage?: string; gallery?: string[]; days?: number | null; nights?: number | null;
  countries?: string; seasons?: string[]; attractions?: string[]; itinerary?: Json[]; descriptionHtml?: string;
  included?: string[]; notIncluded?: string[]; extraInfoHtml?: string; termsHtml?: string; cancellationHtml?: string;
  extraSections?: Json[]; hotels?: Json[]; faq?: Json[]; seoTitle?: string; seoDescription?: string;
  departures?: SiteDeparture[];
  destinationIds?: number[]; audienceIds?: number[]; tagIds?: number[]; artistIds?: number[];
  categoryIds?: number[]; villageIds?: number[];
}
interface SiteEntity { id: number; slug: string; path?: string; name?: string; title?: string; image?: string; excerpt?: string; contentHtml?: string }

const STATUS_BY_LABEL: Record<string, { sale: string; badge?: string }> = {
  "בהרשמה": { sale: "open" },
  "מובטח": { sale: "guaranteed" },
  "מקומות אחרונים": { sale: "last_places" },
  "מלא": { sale: "sold_out" },
  "אזל": { sale: "sold_out" },
  "חדש באתר": { sale: "open", badge: "חדש באתר" },
  "ריק": { sale: "open" },
};

const BLOCK_STATUS: Record<string, string> = {
  OK: "confirmed", DONE: "operational", CXX: "cancelled", NO: "declined", REQ: "requested", FINAL: "approved",
};

const AIRLINE_NAMES: Record<string, string> = {
  LY: "אל על", SN: "Brussels Airlines", "6H": "ישראייר", IZ: "ארקיע", OS: "Austrian", LX: "SWISS", LH: "Lufthansa",
  BA: "British Airways", FZ: "flydubai", AZ: "ITA Airways", IB: "Iberia", RO: "TAROM", TG: "Thai Airways", VS: "Virgin Atlantic",
  A3: "Aegean", WN: "Southwest", PG: "Bangkok Airways", AF: "Air France", KL: "KLM",
};

const SHEET1_CITY: Record<string, string> = {
  BRU: "BRU", PARIS: "CDG", AMS: "AMS", LONDON: "LHR", ZURICH: "ZRH", FRANKFURT: "FRA", MILANO: "MXP", MUNICH: "MUC",
};
const WEEKDAY: Record<string, number> = {
  SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6,
};

// ---------------------------------------------------------------- main
async function main() {
  if (!CONTENT_DIR) throw new Error("--content <mega-family/content> is required");
  console.log(`[import] mode: ${APPLY ? "APPLY" : "dry-run"}${OVERWRITE ? " +overwrite" : ""}${WITH_FLIGHTS ? " +flights" : ""}, from year ${YEAR_FROM}`);

  const { data: company, error: companyError } = await supabaseTyped
    .from("companies").select("id, slug").eq("slug", COMPANY_SLUG).single();
  if (companyError || !company) throw new Error(`company ${COMPANY_SLUG} not found - run the migrations first`);
  const companyId = company.id;
  const counts: Record<string, number> = {};

  // ---- 1. terms -------------------------------------------------------------
  const taxonomies = readJson<Record<string, SiteTerm[]>>("taxonomies.json");
  const termRows: Tours["terms"]["Insert"][] = [];
  for (const [kind, list] of Object.entries(taxonomies)) {
    list.forEach((t, position) => {
      termRows.push({
        company_id: companyId, kind, slug: t.slug, name: t.name, description_html: t.descriptionHtml ?? null,
        hero_images: t.heroImages ?? [], position, legacy_id: t.id, data: t as unknown as Json,
      });
    });
  }
  counts.terms = termRows.length;
  await upsertTours("terms", termRows, "company_id,kind,slug");

  // ---- 2. hotels, cars, instructors, pages ----------------------------------
  const entity = (e: SiteEntity) => ({
    company_id: companyId, slug: e.slug, name: e.name ?? e.title ?? e.slug, image: e.image ?? null,
    content_html: e.contentHtml ?? null, legacy_id: e.id, data: e as unknown as Json,
  });
  const hotels = readJson<SiteEntity[]>("hotels.json");
  const cars = readJson<SiteEntity[]>("cars.json");
  const instructors = readJson<(SiteEntity & { regions?: string; gallery?: Json[] })[]>("instructors.json");
  await upsertTours("hotels", hotels.map((h) => ({ ...entity(h), code: h.slug, excerpt: h.excerpt ?? null })), "company_id,code");
  await upsertTours("cars", cars.map((c) => ({ ...entity(c), code: c.slug })), "company_id,code");
  await upsertTours(
    "instructors",
    instructors.map((x, position) => ({ ...entity(x), regions: x.regions ?? null, excerpt: x.excerpt ?? null, gallery: x.gallery ?? [], position })),
    "company_id,slug",
  );
  counts.hotels = hotels.length; counts.cars = cars.length; counts.instructors = instructors.length;

  const pageRows: Tours["cms_pages"]["Insert"][] = [];
  const pushPages = (file: string, kind: string) => {
    for (const p of readJson<SiteEntity[]>(file)) {
      pageRows.push({
        company_id: companyId, path: p.path ?? `/${p.slug}/`, title: p.title ?? p.name ?? p.slug, kind,
        content_html: p.contentHtml ?? null, legacy_id: p.id, data: p as unknown as Json,
      });
    }
  };
  pushPages("pages.json", "page");
  pushPages("posts.json", "post");
  pushPages("products.json", "product");
  pageRows.push({
    company_id: companyId, path: "_archive-extras", title: "Archive extras", kind: "extras",
    data: readJson<Json>("archive-extras.json"),
  });
  counts.cms_pages = pageRows.length;
  await upsertTours("cms_pages", pageRows, "company_id,path");

  // ---- 3. packages (site pages) ---------------------------------------------
  const sitePackages = readJson<SitePackage[]>("packages.json");
  const packageRows: Tours["packages"]["Insert"][] = sitePackages.map((p) => {
    const { departures: _departures, itinerary: _itinerary, ...rest } = p;
    void _departures; void _itinerary;
    return {
      company_id: companyId, slug: p.slug, name: p.name, subtitle: p.subtitle ?? null,
      kind: p.template === "vacation" ? "vacation" : "organized", brand: p.brand ?? "family",
      hero_image: p.heroImage ?? null, card_image: p.cardImage ?? null, gallery: p.gallery ?? [],
      days: p.days ?? null, nights: p.nights ?? null, countries: p.countries ?? null, seasons: p.seasons ?? [],
      attractions: p.attractions ?? [], description_html: p.descriptionHtml ?? null, included: p.included ?? [],
      not_included: p.notIncluded ?? [], extra_info_html: p.extraInfoHtml ?? null, terms_html: p.termsHtml ?? null,
      cancellation_html: p.cancellationHtml ?? null, extra_sections: p.extraSections ?? [], hotels: p.hotels ?? [],
      faq: p.faq ?? [], seo: { title: p.seoTitle ?? "", description: p.seoDescription ?? "" },
      legacy_id: p.id, data: rest as unknown as Json,
    };
  });

  // ---- 4. the site-feed workbook --------------------------------------------
  const trips: Record<string, Cell>[] = [];
  const vacations: Record<string, Cell>[] = [];
  if (SHEET_FILE) {
    const wb = await workbook(SHEET_FILE);
    const organized = sheetByName(wb, (n) => n.includes("Organized Trips"));
    const vacation = sheetByName(wb, (n) => n.includes("Vacation Packages") && !/\bc$/.test(n));
    if (organized) trips.push(...keyedRows(organized, 3).filter((r) => str(r.pck_code) && num(r.pck_number) !== null));
    if (vacation) vacations.push(...keyedRows(vacation, 3).filter((r) => str(r.pck_code) && num(r.pck_number) !== null && isoDate(r.departure_date)));
  }
  counts.sheet_organized_rows = trips.length;
  counts.sheet_vacation_rows = vacations.length;

  // pages that exist only in the sheet (no archived content): inactive stubs, so their series have a home
  const packageByName = new Map(sitePackages.map((p) => [nameKey(p.name), p.slug]));
  const packageByCode = new Map(sitePackages.filter((p) => p.code).map((p) => [String(p.code).toUpperCase(), p.slug]));
  const stubSlugs = new Map<string, string>();
  for (const r of [...trips, ...vacations]) {
    // a series with no page name in the sheet still needs a home: the stub is named after its code
    const name = str(r.pck_name) || str(r.pck_code).toUpperCase();
    if (!name || packageByName.has(nameKey(name)) || packageByCode.has(name) || stubSlugs.has(nameKey(name))) continue;
    const slug = slugify(name);
    stubSlugs.set(nameKey(name), slug);
    packageRows.push({
      company_id: companyId, slug, name, kind: trips.includes(r) ? "organized" : "vacation",
      brand: str(r.audience) === "ספורט ומוזיקה" ? "events" : "family", is_active: false,
      data: { stub: true } as Json,
    });
  }
  counts.packages = packageRows.length;
  counts.packages_without_page = stubSlugs.size;
  await upsertTours("packages", packageRows, "company_id,slug");

  const dbPackages = APPLY ? await selectTours("packages", "id, slug, legacy_id", companyId) : [];
  const packageId = new Map(dbPackages.map((p) => [String(p.slug), String(p.id)]));
  const dbTerms = APPLY ? await selectTours("terms", "id, kind, slug, name, legacy_id", companyId) : [];
  const termByLegacy = new Map(dbTerms.map((t) => [`${t.kind}:${t.legacy_id}`, String(t.id)]));
  const termByName = new Map(dbTerms.map((t) => [`${t.kind}:${nameKey(String(t.name))}`, String(t.id)]));

  // itineraries + package terms
  if (APPLY) {
    const itineraries: Tours["package_itineraries"]["Insert"][] = [];
    const packageTerms: Tours["package_terms"]["Insert"][] = [];
    const TERM_FIELDS: [keyof SitePackage, string][] = [
      ["destinationIds", "destinations"], ["audienceIds", "audiences"], ["tagIds", "tags"],
      ["artistIds", "artists"], ["categoryIds", "categories"], ["villageIds", "villages"],
    ];
    for (const p of sitePackages) {
      const pid = packageId.get(p.slug);
      if (!pid) continue;
      itineraries.push({ company_id: companyId, package_id: pid, key: "main", label: "מסלול ראשי", days: (p.itinerary ?? []) as Json });
      for (const [field, kind] of TERM_FIELDS) {
        for (const legacy of (p[field] as number[] | undefined) ?? []) {
          const tid = termByLegacy.get(`${kind}:${legacy}`);
          if (tid) packageTerms.push({ package_id: pid, term_id: tid });
        }
      }
      const self = termByLegacy.get(`packages:${p.id}`);
      if (self) packageTerms.push({ package_id: pid, term_id: self });
    }
    await upsertTours("package_itineraries", itineraries, "package_id,key");
    await upsertTours("package_terms", packageTerms, "package_id,term_id");
    counts.package_terms = packageTerms.length;
  }

  // ---- 5. series ------------------------------------------------------------
  interface SeriesAgg { code: string; pageName: string; airports: Map<string, number>; kidAges: Map<number, number>; currency: string; audience: string; tags: Set<string>; destinations: Set<string> }
  const seriesAgg = new Map<string, SeriesAgg>();
  const bump = <K,>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);
  const top = <K,>(m: Map<K, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const r of [...trips, ...vacations]) {
    const code = str(r.pck_code).toUpperCase();
    const agg = seriesAgg.get(code) ?? { code, pageName: "", airports: new Map(), kidAges: new Map(), currency: "", audience: "", tags: new Set(), destinations: new Set() };
    if (!agg.pageName && str(r.pck_name)) agg.pageName = str(r.pck_name);
    if (str(r.destination) && str(r.return_from)) bump(agg.airports, `${str(r.destination)}>${str(r.return_from)}`);
    const kid = num(r.kid_age); if (kid) bump(agg.kidAges, kid);
    if (!agg.currency) agg.currency = str(r.currency) || str(r.currncey);
    if (!agg.audience) agg.audience = str(r.audience);
    str(r.tags).split(",").map((t) => t.trim()).filter(Boolean).forEach((t) => agg.tags.add(t));
    str(r.destinations).split(",").map((t) => t.trim()).filter(Boolean).forEach((t) => agg.destinations.add(t));
    seriesAgg.set(code, agg);
  }
  // series that exist only on the site (no sheet rows)
  for (const p of sitePackages) {
    const code = String(p.code ?? "").toUpperCase();
    if (code && !seriesAgg.has(code)) seriesAgg.set(code, { code, pageName: p.name, airports: new Map(), kidAges: new Map(), currency: "", audience: "", tags: new Set(), destinations: new Set() });
  }

  // Sheet1: routing pattern of a series (arrival city + weekday, return city + weekday)
  const routing = new Map<string, { arrCity?: string; arrDay?: number; retCity?: string; retDay?: number }>();
  if (FLIGHTS_FILE) {
    const wb = await workbook(FLIGHTS_FILE);
    const s1 = sheetByName(wb, (n) => n === "Sheet1");
    if (s1) {
      const cities: Record<number, string> = {};
      s1.getRow(1).eachCell((c, col) => { cities[col] = str(cell(c.value)).toUpperCase(); });
      for (let r = 2; r <= s1.rowCount; r++) {
        const code = str(cell(s1.getRow(r).getCell(1).value)).toUpperCase();
        if (!code) continue;
        const entry: { arrCity?: string; arrDay?: number; retCity?: string; retDay?: number } = {};
        for (const [colText, city] of Object.entries(cities)) {
          const col = Number(colText);
          const day = WEEKDAY[str(cell(s1.getRow(r).getCell(col).value)).toUpperCase()];
          if (day === undefined || !SHEET1_CITY[city]) continue;
          if (col <= 10) { entry.arrCity = SHEET1_CITY[city]; entry.arrDay = day; } else { entry.retCity = SHEET1_CITY[city]; entry.retDay = day; }
        }
        routing.set(code, entry);
      }
    }
  }

  const packageSlugFor = (pageName: string, code: string) =>
    packageByName.get(nameKey(pageName)) ?? stubSlugs.get(nameKey(pageName)) ?? packageByCode.get(code) ?? stubSlugs.get(nameKey(code));

  const seriesRows: Tours["series"]["Insert"][] = [...seriesAgg.values()].map((a) => {
    const [arr, ret] = (top(a.airports) ?? ">").split(">");
    const route = routing.get(a.code) ?? {};
    const slug = packageSlugFor(a.pageName, a.code);
    if (!slug) note("series_without_page", a.code, a.pageName || "(no page name)");
    return {
      company_id: companyId, code: a.code, package_id: slug ? packageId.get(slug) ?? null : null,
      arrival_airport: arr || route.arrCity || null, return_airport: ret || route.retCity || null,
      arrival_weekday: route.arrDay ?? null, return_weekday: route.retDay ?? null,
      default_currency: ["EUR", "GBP", "USD"].includes(a.currency) ? a.currency : "USD",
      child_max_age: top(a.kidAges) ?? 16,
    };
  });
  counts.series = seriesRows.length;
  await upsertTours("series", seriesRows, "company_id,code");
  const dbSeries = APPLY ? await selectTours("series", "id, code, package_id", companyId) : [];
  const seriesId = new Map(dbSeries.map((s) => [String(s.code), String(s.id)]));
  const seriesPackage = new Map(dbSeries.map((s) => [String(s.code), s.package_id ? String(s.package_id) : null]));

  if (APPLY) {
    const seriesTerms: Tours["series_terms"]["Insert"][] = [];
    for (const a of seriesAgg.values()) {
      const sid = seriesId.get(a.code);
      if (!sid) continue;
      const wanted: [string, string][] = [["audiences", a.audience], ...[...a.tags].map((t): [string, string] => ["tags", t]), ...[...a.destinations].map((t): [string, string] => ["destinations", t])];
      for (const [kind, name] of wanted) {
        if (!name) continue;
        const tid = termByName.get(`${kind}:${nameKey(name)}`);
        if (tid) seriesTerms.push({ series_id: sid, term_id: tid });
        else note("term_not_on_site", a.code, `${kind}: ${name}`);
      }
    }
    await upsertTours("series_terms", seriesTerms, "series_id,term_id");
    counts.series_terms = seriesTerms.length;
  }

  // ---- 6. departures ---------------------------------------------------------
  interface Dep {
    row: Tours["departures"]["Insert"]; seriesCode: string;
    prices: { pax_type: string; room_position: number; price: number }[];
    options: Omit<Tours["departure_options"]["Insert"], "departure_id" | "company_id">[];
    promotions: Omit<Tours["promotions"]["Insert"], "departure_id" | "company_id">[];
    flight: { out: string; back: string; outDate: string | null };
  }
  const deps = new Map<string, Dep>(); // key = code:year
  const pctValue = (v: number) => (v <= 1 ? Math.round(v * 10000) / 100 : v);

  const fromSheet = (r: Record<string, Cell>, kind: "organized" | "vacation") => {
    const series = str(r.pck_code).toUpperCase();
    const code = `${series}${Math.round(num(r.pck_number) ?? 0)}`;
    const start = isoDate(r.departure_date);
    let end = isoDate(r.return_date);
    if (!start) { note("departure_without_date", code, `row ${r._row}`); return; }
    if (!end || end < start) {
      note("bad_return_date", code, `departure ${start}, return ${end ?? "empty"} (sheet row ${r._row})`);
      end = isoDate(r.return_arrival_date) && String(isoDate(r.return_arrival_date)) >= start ? isoDate(r.return_arrival_date) : start;
    }
    const year = Number(start.slice(0, 4));
    if (year < YEAR_FROM) { note("departure_before_year_from", code, `departure ${start} (sheet row ${r._row})`); return; }
    const mmdd = `${Number(start.slice(5, 7))}${start.slice(8, 10)}`;
    if (String(Math.round(num(r.pck_number) ?? 0)) !== mmdd) note("code_date_mismatch", code, `code says ${Math.round(num(r.pck_number) ?? 0)}, departure is ${start}`);
    const statusLabel = str(r.status) || str(r.STATUS);
    const status = STATUS_BY_LABEL[statusLabel] ?? { sale: "open" };
    if (statusLabel && !STATUS_BY_LABEL[statusLabel]) note("unknown_status", code, statusLabel);
    const meetingDate = isoDate(r.team_meeting_date);
    const rate = num(r.rate) ?? 0;
    const row: Tours["departures"]["Insert"] = {
      company_id: companyId, package_id: "", series_id: "", code, season_year: year, start_date: start, end_date: end!,
      season: str(r.season) || null, currency: ["EUR", "GBP", "USD"].includes(str(r.currency) || str(r.currncey)) ? (str(r.currency) || str(r.currncey)) : "USD",
      is_published: false, sale_status: status.sale, card_badge: status.badge ?? null,
      date_labels: [1, 2, 3].map((i) => str(r[`product_page_hero_label_${i}`])).filter(Boolean),
      arrival_airport: str(r.destination).slice(0, 3) || null, return_airport: str(r.return_from).slice(0, 3) || null,
      meeting_at: meetingDate ? `${meetingDate}T${hhmm(r.team_meeting_time) ?? "00:00"}:00+03:00` : null,
      flight_mode: rate > 0 ? "priced" : "included", flight_price: rate,
      baggage_included: r.baggage === null ? true : truthy(r.baggage), meal_included: r.food === null ? true : truthy(r.food),
      transfers_included: truthy(r.transfers ?? null),
      connection_out: str(r.connection) || null, connection_back: str(r.connection_return) || null,
      child_max_age: num(r.kid_age), senior_min_age: num(r.senior_age), senior_discount: num(r.senior_discount),
      markup_percent: num(r["percentage__markup"] ?? r["percentage_markup"] ?? null), markup_fixed: num(r["fixed__markup"] ?? r["fixed_markup"] ?? null),
    };
    const dep: Dep = { row, seriesCode: series, prices: [], options: [], promotions: [], flight: { out: str(r.departure_flight_code), back: str(r.return_flight_code), outDate: start } };

    const matrix: [string, string, number][] = [
      ["adult_single_room", "adult", 1], ["adult_double_room", "adult", 2], ["third_adult_room", "adult", 3],
      ["second_kid_room", "child", 2], ["third_kid_room", "child", 3], ["fourth_kid_room", "child", 4],
    ];
    for (const [key, pax, pos] of matrix) {
      const p = num(r[key] ?? null);
      if (p !== null && p > 0) dep.prices.push({ pax_type: pax, room_position: pos, price: p });
    }

    const promo = (kindName: string, value: number | null, label: string, until: Cell) => {
      if ((value === null || value === 0) && !label) return;
      dep.promotions.push({ kind: kindName, value, label: label || null, valid_until: isoDate(until), show_on_card: kindName !== "fixed_per_order" });
    };
    const pct = num(r.percentage_discount);
    promo("percent_order", pct === null ? null : pctValue(pct), "", r.percentage_exp);
    promo("fixed_per_pax", num(r.fixed_discount), "", r.fixed_exp);
    promo("fixed_per_order", num(r.purchase_discount), str(r.purchase_discount_text ?? null), null);
    promo("named_per_pax", num(r.unique_discount), str(r.unique_discount_text), r.unique_discount_exp);
    if (str(r.unique_gift)) promo("gift", null, str(r.unique_gift), r.unique_gift_exp);
    if (pct && num(r.fixed_discount)) note("both_discounts", code, "percent and fixed-per-passenger are both set");

    if (kind === "vacation") {
      for (const i of [1, 2, 3]) {
        const ref = str(r[`hotel_code_${i}`] ?? null);
        if (!ref) continue;
        dep.options.push({
          kind: "hotel", position: i, ref_code: ref, board: str(r[`hotel_${i}_food`] ?? null) || null,
          room_prices: { double: num(r[`dual_room_${i}`] ?? null), triple: num(r[`triple_room_${i}`] ?? null), quad: num(r[`quadro_room_${i}`] ?? null) } as Json,
          price_unit: "per_stay",
        });
      }
      for (const i of [1, 2, 3, 4]) {
        const label = str(r[`ticket_label_${i}`] ?? null);
        if (!label) continue;
        dep.options.push({ kind: "ticket", position: i, label, price: num(r[`ticket_price_${i}`] ?? null), price_unit: "per_person" });
      }
    }
    const key = `${code}:${year}`;
    if (deps.has(key)) note("duplicate_code", code, `two sheet rows for ${year}`);
    deps.set(key, dep);
  };
  trips.forEach((r) => fromSheet(r, "organized"));
  vacations.forEach((r) => fromSheet(r, "vacation"));
  counts.departures_from_sheet = deps.size;

  // the dated products the site shows today: publish them and keep their presentation payload
  let published = 0;
  for (const p of sitePackages) {
    for (const d of p.departures ?? []) {
      if (!d.startDate || !d.endDate) { note("site_departure_without_dates", d.code, p.slug); continue; }
      const year = Number(d.startDate.slice(0, 4));
      const key = `${d.code}:${year}`;
      const status = STATUS_BY_LABEL[d.status?.label ?? ""] ?? { sale: d.soldOut ? "sold_out" : "open" };
      let dep = deps.get(key);
      if (!dep) {
        const series = String(p.code ?? d.code.replace(/\d+$/, "")).toUpperCase();
        note("site_departure_not_in_sheet", d.code, `${p.name} ${d.startDate}`);
        dep = {
          row: {
            company_id: companyId, package_id: "", series_id: "", code: d.code, season_year: year,
            start_date: d.startDate, end_date: d.endDate, season: d.season ?? null, currency: d.currency ?? "USD",
            sale_status: status.sale, card_badge: status.badge ?? null, date_labels: d.tags ?? [],
          },
          seriesCode: series, prices: [], options: [], promotions: [], flight: { out: "", back: "", outDate: d.startDate },
        };
        if (d.discount?.fixedPerPerson) dep.promotions.push({ kind: "fixed_per_pax", value: d.discount.fixedPerPerson, show_on_card: true });
        deps.set(key, dep);
        if (!seriesAgg.has(series)) note("series_missing_for_site_departure", d.code, series);
      } else {
        if (dep.row.start_date !== d.startDate || dep.row.end_date !== d.endDate) {
          note("site_vs_sheet_dates", d.code, `site ${d.startDate}..${d.endDate}, sheet ${dep.row.start_date}..${dep.row.end_date}`);
        }
        // what the customer sees today wins for the presentation fields
        dep.row.sale_status = status.sale;
        dep.row.card_badge = status.badge ?? null;
        dep.row.date_labels = d.tags ?? dep.row.date_labels;
        dep.row.currency = d.currency ?? dep.row.currency;
      }
      dep.row.is_published = true;
      dep.row.legacy_product_id = d.productId;
      dep.row.data = d as unknown as Json;
      dep.row.package_id = packageId.get(p.slug) ?? "";
      published++;
    }
  }
  counts.departures = deps.size;
  counts.departures_published = published;

  if (APPLY) {
    const existing = new Set((await selectTours("departures", "code, season_year", companyId)).map((d) => `${d.code}:${d.season_year}`));
    const rows: Tours["departures"]["Insert"][] = [];
    for (const [key, dep] of deps) {
      const sid = seriesId.get(dep.seriesCode);
      const pid = dep.row.package_id || seriesPackage.get(dep.seriesCode) || "";
      if (!sid || !pid) { note("departure_skipped", dep.row.code, !sid ? `series ${dep.seriesCode} missing` : "no page for the series"); deps.delete(key); continue; }
      dep.row.series_id = sid; dep.row.package_id = pid;
      rows.push(dep.row);
    }
    await upsertTours("departures", rows, "company_id,code,season_year");
    const dbDeps = await selectTours("departures", "id, code, season_year", companyId);
    const depId = new Map(dbDeps.map((d) => [`${d.code}:${d.season_year}`, String(d.id)]));
    const prices: Tours["departure_prices"]["Insert"][] = [];
    const options: Tours["departure_options"]["Insert"][] = [];
    const promotions: Tours["promotions"]["Insert"][] = [];
    for (const [key, dep] of deps) {
      const id = depId.get(key);
      if (!id) continue;
      for (const p of dep.prices) prices.push({ ...p, departure_id: id, company_id: companyId });
      // options and promotions have no natural key: written only for departures this run created
      if (existing.has(key) && !OVERWRITE) continue;
      for (const o of dep.options) options.push({ ...o, departure_id: id, company_id: companyId });
      for (const p of dep.promotions) promotions.push({ ...p, departure_id: id, company_id: companyId });
    }
    await upsertTours("departure_prices", prices, "departure_id,pax_type,room_position");
    if (OVERWRITE) {
      const ids = [...deps.keys()].map((k) => depId.get(k)).filter((x): x is string => !!x);
      for (const part of chunk(ids, 200)) {
        await tours.from("departure_options").delete().in("departure_id", part);
        await tours.from("promotions").delete().in("departure_id", part);
      }
    }
    for (const part of chunk(options)) { const { error } = await tours.from("departure_options").insert(part, { defaultToNull: false }); if (error) throw new Error(`departure_options: ${error.message}`); }
    for (const part of chunk(promotions)) { const { error } = await tours.from("promotions").insert(part, { defaultToNull: false }); if (error) throw new Error(`promotions: ${error.message}`); }
    counts.departure_prices = prices.length; counts.departure_options = options.length; counts.promotions = promotions.length;
  } else {
    counts.departure_prices = [...deps.values()].reduce((s, d) => s + d.prices.length, 0);
    counts.departure_options = [...deps.values()].reduce((s, d) => s + d.options.length, 0);
    counts.promotions = [...deps.values()].reduce((s, d) => s + d.promotions.length, 0);
  }

  // ---- 7. flight workbook: calendar, contracts, blocks -----------------------
  if (FLIGHTS_FILE) await importFlightWorkbook(companyId, deps, counts);

  // ---- report ----------------------------------------------------------------
  const byKind: Record<string, number> = {};
  for (const e of exceptions) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  writeFileSync(REPORT_FILE, JSON.stringify({ applied: APPLY, counts, exceptionsByKind: byKind, exceptions }, null, 1), "utf8");
  console.log("[import] counts:", counts);
  console.log("[import] exceptions:", byKind);
  console.log(`[import] report: ${REPORT_FILE}`);
  if (!APPLY) console.log("[import] dry-run - nothing was written. Add --apply to write.");
}

// ---------------------------------------------------------------- flight workbook
async function importFlightWorkbook(
  companyId: string,
  deps: Map<string, { row: Tours["departures"]["Insert"]; flight: { out: string; back: string; outDate: string | null } }>,
  counts: Record<string, number>,
) {
  const wb = await workbook(FLIGHTS_FILE);

  // calendar ("חופשות")
  const holidays = sheetByName(wb, (n) => n === "חופשות");
  const calendar: Pub["calendar_periods"]["Insert"][] = [];
  if (holidays) {
    for (let r = 2; r <= holidays.rowCount; r++) {
      const c = (i: number) => cell(holidays.getRow(r).getCell(i).value);
      const year = num(c(1)); const name = str(c(2));
      if (!year || !name) continue;
      const texts = [c(4), c(5), c(6)].filter((v) => v !== null && !isoDate(v)).map(str).filter(Boolean);
      calendar.push({
        company_id: companyId, year, name,
        kind: /צום|באב/.test(name) ? "fast" : /CARN|CANAVAL/i.test(name) ? "carnival" : "holiday",
        holiday_date: isoDate(c(4)), start_date: isoDate(c(5)), end_date: isoDate(c(6)), note: texts.join(" | ") || null,
      });
    }
  }
  counts.calendar_periods = calendar.length;
  if (APPLY && calendar.length) {
    const { count } = await supabaseTyped.from("calendar_periods").select("id", { count: "exact", head: true }).eq("company_id", companyId);
    if (!count || OVERWRITE) {
      if (OVERWRITE) await supabaseTyped.from("calendar_periods").delete().eq("company_id", companyId);
      const { error } = await supabaseTyped.from("calendar_periods").insert(calendar, { defaultToNull: false });
      if (error) throw new Error(`calendar_periods: ${error.message}`);
    }
  }

  const ws = sheetByName(wb, (n) => n === "FLIGHT");
  if (!ws) { note("workbook", "FLIGHT", "sheet not found"); return; }
  const C = { YEAR: 1, STATUS: 2, SERIES: 3, TOUR: 4, TOUR_STATUS: 5, DEPT_DATE: 6, DEST: 7, DEPT_FLIGHT: 8, DEPT_TIME: 9, RET_DATE: 10, RET_FROM: 11, RET_FLIGHT: 12, RET_TIME: 13, AIRLINE: 14, SEATS: 15, PNR: 16, GROUP: 17, REMARKS: 18, CXX1: 19, CXX2: 20, CXX_HOTEL: 21, DOCKET: 22, EMD1: 23, EMD2: 24, REDUCE: 26, ADT: 27, CHD: 28, TAX: 29, CUR: 32, TYPE_A: 33, TYPE_B: 34, CONTRACT: 35, FEE_GROUP: 36, FEE_PAX: 37, ORIG: 38, SOLD: 41 };

  interface Block { row: Pub["flights"]["Insert"]; tourCodes: string[]; docket: string; sold: number | null; contract: string; depDate: string; emd: string[]; log: string; live: boolean }
  const blocks: Block[] = [];
  const contractNames = new Set<string>();
  const tourCode = /^[A-Z]{2,5}\d{3,4}$/;

  for (let r = 2; r <= ws.rowCount; r++) {
    const c = (i: number) => cell(ws.getRow(r).getCell(i).value);
    const year = num(c(C.YEAR));
    const depDate = isoDate(c(C.DEPT_DATE));
    if (!year || year < YEAR_FROM || !depDate) continue;
    // total / subtotal rows of the workbook carry a year and a date but no series and no destination
    if ((!str(c(C.SERIES)) && !str(c(C.DEST))) || /TOTAL/i.test(str(c(C.TOUR))) || /TOTAL/i.test(str(c(C.SERIES)))) continue;
    let retDate = isoDate(c(C.RET_DATE));
    if (!retDate || retDate < depDate) { note("block_bad_return_date", `row ${r}`, `${str(c(C.SERIES))} ${depDate} -> ${retDate ?? "empty"}`); retDate = depDate; }

    const leg = (v: Cell, date: string) => {
      const m = /(\d{1,2}):(\d{2})\s*([-+])\s*(\d{1,2}):(\d{2})/.exec(str(v));
      if (!m) return { dep: `${date}T00:00:00`, arr: `${date}T00:00:00`, ok: false };
      const arrDate = m[3] === "+" ? addDays(date, 1) : date;
      return { dep: `${date}T${pad(Number(m[1]))}:${m[2]}:00`, arr: `${arrDate}T${pad(Number(m[4]))}:${m[5]}:00`, ok: true };
    };
    const out = leg(c(C.DEPT_TIME), depDate);
    const back = leg(c(C.RET_TIME), retDate);

    const airlines = str(c(C.AIRLINE)).toUpperCase().split(/[+/]/).map((a) => a.trim().split(/[\s-]/)[0]).filter(Boolean);
    const airline = (airlines[0] && airlines[0] !== "NO" ? airlines[0] : "XX").slice(0, 3);
    const inboundAirline = airlines[1] && airlines[1] !== airline ? airlines[1].slice(0, 3) : null;
    const flightNo = (v: Cell, code: string) => {
      const first = str(v).split("+")[0].trim().replace(/\.0$/, "");
      if (!first) return "";
      return (/^\d+$/.test(first) ? `${code === "XX" ? "" : code}${first}` : first.replace(/\s+/g, "")).slice(0, 10);
    };

    const statusRaw = str(c(C.STATUS)).toUpperCase();
    const status = BLOCK_STATUS[statusRaw] ?? null;
    if (statusRaw && !status) note("block_unknown_status", `row ${r}`, statusRaw);
    const series = str(c(C.SERIES));
    const tour = str(c(C.TOUR)).toUpperCase();
    const codes = tour.includes("/")
      ? (() => { const parts = tour.split("/").map((p) => p.trim()); const digits = /\d{3,4}$/.exec(tour)?.[0] ?? ""; return parts.map((p) => (tourCode.test(p) ? p : /^[A-Z]{2,5}$/.test(p) && digits ? `${p}${digits}` : "")).filter(Boolean); })()
      : tourCode.test(tour) ? [tour] : [];
    const seats = num(c(C.SEATS));
    const currency = str(c(C.CUR)).toUpperCase().replace("UDS", "USD");
    const remarks = str(c(C.REMARKS));
    const contract = str(c(C.CONTRACT));
    if (contract) contractNames.add(contract);
    const feeGroup = num(c(C.FEE_GROUP));
    const feePax = num(c(C.FEE_PAX));
    const pnr = str(c(C.PNR));
    const ref = createHash("sha1").update([year, series, tour, depDate, str(c(C.DEST)), str(c(C.DEPT_FLIGHT)), pnr, r].join("|")).digest("hex").slice(0, 20);

    blocks.push({
      row: {
        company_id: companyId, import_ref: `flight-xlsx:${ref}`,
        initial_quantity: seats ?? 0, original_quantity: num(c(C.ORIG)), price: 0, duration: "00:00:00", stops: 0,
        airline_code: airline, inbound_airline_code: inboundAirline,
        metadata_iata: airline, metadata_name: AIRLINE_NAMES[airline] ?? airline, metadata_logo: "",
        outbound_departure_time: out.dep, outbound_departure_airport: "TLV", outbound_arrival_airport: (str(c(C.DEST)).toUpperCase() || "XXX").slice(0, 3),
        outbound_arrival_time: out.arr, outbound_duration: "00:00:00", outbound_check_bags_included: true, outbound_cabin_bags_included: true,
        outbound_flight_number: flightNo(c(C.DEPT_FLIGHT), airline),
        inbound_departure_time: back.dep, inbound_departure_airport: (str(c(C.RET_FROM)).toUpperCase() || "XXX").slice(0, 3), inbound_arrival_airport: "TLV",
        inbound_arrival_time: back.arr, inbound_duration: "00:00:00", inbound_check_bags_included: true, inbound_cabin_bags_included: true,
        inbound_flight_number: flightNo(c(C.RET_FLIGHT), inboundAirline ?? airline),
        block_status: status, pnr: pnr || null, group_code: str(c(C.GROUP)) || null, series_name: series || null,
        season_label: codes.length ? str(c(C.TYPE_A)) || null : tour || str(c(C.TYPE_A)) || null,
        notes: [remarks, str(c(C.TOUR_STATUS)) && `Tour status: ${str(c(C.TOUR_STATUS))}`, str(c(C.CXX_HOTEL)) && `CXX hotel: ${str(c(C.CXX_HOTEL))}`, !out.ok && str(c(C.DEPT_TIME)) && `Dept time: ${str(c(C.DEPT_TIME))}`, !back.ok && str(c(C.RET_TIME)) && `Ret time: ${str(c(C.RET_TIME))}`].filter(Boolean).join("\n") || null,
        cost_price: num(c(C.ADT)), cost_child_price: num(c(C.CHD)), cost_tax: num(c(C.TAX)), cost_currency: ["USD", "EUR", "GBP", "ILS"].includes(currency) ? currency : null,
        first_cancellation_date: isoDate(c(C.CXX1)), last_cancellation_date: isoDate(c(C.CXX2)),
        cancellation_fee: feeGroup ?? feePax, cancel_reason: status === "cancelled" ? remarks || str(c(C.REDUCE)) || null : null,
      },
      tourCodes: codes, docket: str(c(C.DOCKET)).replace(/\.0$/, ""), sold: num(c(C.SOLD)), contract, depDate,
      emd: [isoDate(c(C.EMD1)), isoDate(c(C.EMD2))].filter((d): d is string => !!d), log: str(c(C.REDUCE)),
      live: status === "confirmed" || status === "operational",
    });
  }
  counts.flight_blocks = blocks.length;
  counts.flight_blocks_with_tour_code = blocks.filter((b) => b.tourCodes.length).length;
  counts.flight_contracts = contractNames.size;

  // ---- exceptions that do not need the database: site departures vs blocks ----
  const blocksByCode = new Map<string, Block[]>();
  for (const b of blocks) for (const code of b.tourCodes) blocksByCode.set(code, [...(blocksByCode.get(code) ?? []), b]);
  for (const dep of deps.values()) {
    const start = String(dep.row.start_date);
    const matches = (blocksByCode.get(String(dep.row.code)) ?? []).filter((b) => Math.abs(dayDiff(b.depDate, start)) <= 2);
    if (matches.length === 0) { note("departure_without_block", String(dep.row.code), start); continue; }
    const live = matches.filter((b) => b.live);
    if (live.length === 0) note(dep.row.is_published ? "published_all_blocks_cancelled" : "all_blocks_cancelled", String(dep.row.code), `${start}: ${matches.map((b) => b.row.block_status ?? "no status").join(", ")}`);
    for (const b of live) {
      if (b.depDate !== start) note("block_date_differs", String(dep.row.code), `departure ${start}, block ${b.depDate}`);
      const want = dep.flight.out.replace(/\D/g, ""); const got = String(b.row.outbound_flight_number).replace(/\D/g, "");
      if (want && got && want !== got) note("flight_number_differs", String(dep.row.code), `sheet ${dep.flight.out}, block ${b.row.outbound_flight_number}`);
    }
  }

  if (!APPLY) return;

  // contracts (name + the source wording of the whole conditions sheet on a reference row)
  const conditions = sheetByName(wb, (n) => n.startsWith("CXX FEES"));
  const wording: string[] = [];
  if (conditions) for (let r = 1; r <= conditions.rowCount; r++) { const t = str(cell(conditions.getRow(r).getCell(2).value)); if (t) wording.push(t); }
  const contractRows: Pub["flight_contracts"]["Insert"][] = [...contractNames].map((name) => ({
    company_id: companyId, name, kind: name.startsWith("חוזה") ? "series_contract" : "closed_group",
    airline_group: /אלעל|אל על/.test(name) ? "LY" : /ARKIA/i.test(name) ? "IZ" : null,
  }));
  if (wording.length) contractRows.push({ company_id: companyId, name: "תנאי ביטול והתחייבות (מסמך מקור)", kind: "closed_group", terms_text: wording.join("\n"), is_active: false });
  for (const part of chunk(contractRows)) {
    const { error } = await supabaseTyped.from("flight_contracts").upsert(part, { onConflict: "company_id,name", ignoreDuplicates: !OVERWRITE, defaultToNull: false });
    if (error) throw new Error(`flight_contracts: ${error.message}`);
  }

  if (!WITH_FLIGHTS) { console.log("[import] flight blocks parsed but NOT written (pass --with-flights)."); return; }

  const { data: contracts } = await supabaseTyped.from("flight_contracts").select("id, name").eq("company_id", companyId);
  const contractId = new Map((contracts ?? []).map((x) => [x.name, x.id]));
  for (const b of blocks) b.row.contract_id = b.contract ? contractId.get(b.contract) ?? null : null;

  const { data: existingRefs } = await supabaseTyped.from("flights").select("import_ref").eq("company_id", companyId).not("import_ref", "is", null);
  const known = new Set((existingRefs ?? []).map((x) => x.import_ref));
  const fresh = blocks.filter((b) => !known.has(b.row.import_ref ?? ""));
  for (const part of chunk(fresh.map((b) => b.row), 200)) {
    const { error } = await supabaseTyped.from("flights").insert(part, { defaultToNull: false });
    if (error) throw new Error(`flights: ${error.message}`);
  }
  counts.flight_blocks_inserted = fresh.length;

  const { data: dbBlocks } = await supabaseTyped.from("flights").select("id, import_ref").eq("company_id", companyId).not("import_ref", "is", null).range(0, 9999);
  const blockId = new Map((dbBlocks ?? []).map((x) => [x.import_ref, x.id]));
  const dbDeps = await selectTours("departures", "id, code, season_year, start_date, docket_no", companyId);
  const depsByCode = new Map<string, Row[]>();
  for (const d of dbDeps) depsByCode.set(String(d.code), [...(depsByCode.get(String(d.code)) ?? []), d]);

  const allocations: Tours["flight_allocations"]["Insert"][] = [];
  const events: Pub["flight_block_events"]["Insert"][] = [];
  const sales: Tours["departure_sales_entries"]["Insert"][] = [];
  const dockets: { id: string; docket: string }[] = [];
  for (const b of fresh) {
    const fid = blockId.get(b.row.import_ref ?? "");
    if (!fid) continue;
    if (b.log) events.push({ flight_id: fid, kind: "note", happened_on: b.depDate, note: b.log });
    b.emd.forEach((d, i) => events.push({ flight_id: fid, kind: "deposit_paid", happened_on: d, note: i === 0 ? "EMD 1" : "EMD 2" }));
    const targets = b.tourCodes.flatMap((code) => (depsByCode.get(code) ?? []).filter((d) => Math.abs(dayDiff(b.depDate, String(d.start_date))) <= 2));
    targets.forEach((d, i) => {
      allocations.push({ company_id: companyId, flight_id: fid, departure_id: String(d.id), seats: targets.length === 1 ? Number(b.row.initial_quantity) : 0, legs: "both" });
      if (b.docket && !d.docket_no) dockets.push({ id: String(d.id), docket: b.docket });
      if (i === 0 && b.sold && b.sold > 0 && b.live) sales.push({ company_id: companyId, departure_id: String(d.id), flight_id: fid, pax: Math.round(b.sold), docket_no: b.docket || null, note: "נטען מקובץ הטיסות" });
    });
  }
  await upsertTours("flight_allocations", allocations, "flight_id,departure_id,legs");
  for (const part of chunk(events)) { const { error } = await supabaseTyped.from("flight_block_events").insert(part, { defaultToNull: false }); if (error) throw new Error(`flight_block_events: ${error.message}`); }
  for (const part of chunk(sales)) { const { error } = await tours.from("departure_sales_entries").insert(part, { defaultToNull: false }); if (error) throw new Error(`departure_sales_entries: ${error.message}`); }
  for (const d of dockets) await tours.from("departures").update({ docket_no: d.docket }).eq("id", d.id).is("docket_no", null);
  counts.flight_allocations = allocations.length; counts.flight_block_events = events.length; counts.sales_entries = sales.length;
}

main().catch((err) => {
  console.error("[import] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
