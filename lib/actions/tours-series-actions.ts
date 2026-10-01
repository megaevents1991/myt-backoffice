"use server";

/**
 * Series of the "tours" product type (/tours/series): the list, the edit form
 * and "season duplication" - proposing a season of departures from the series
 * pattern and creating the ones the operator ticked.
 *
 * Every action starts with requireCompany("tours") and filters every query by
 * that company. Expected failures come back as { success: false, error }.
 *
 * Spec: mega-family/docs/plans/MEGA-FAMILY-FUNCTIONAL-SPEC.md (4.7, 5.3, 6).
 */
import { logAudit } from "@/lib/audit";
import { requireCompany } from "@/lib/company";
import { supabaseTyped } from "@/lib/supabase-server";
import { TOURS_PAGE_SIZE, toursDb } from "@/lib/tours/db";
import { CURRENCIES } from "@/types/tours.types";
import {
  departureCode,
  isIsoDate,
  nightsBetween,
  normalizeAirport,
  seasonYearOf,
  todayIso,
} from "@/components/tours/departures/departure-utils";
import type { ActionResult, BoardPackage, BoardPeriod, BoardSeries } from "@/components/tours/departures/types";
import {
  SERIES_TERM_KINDS,
  type SeasonContext,
  type SeasonCreateInput,
  type SeasonCreateResult,
  type SeasonExistingDeparture,
  type SeriesInput,
  type SeriesListRow,
  type SeriesScreenData,
  type SeriesTerm,
  type SeriesTermKind,
} from "@/components/tours/series/types";

// ---------------------------------------------------------------- plumbing
/** A failure the operator can act on; its message is shown as is. */
class UserError extends Error {}

function fail(e: unknown): { success: false; error: string } {
  if (e instanceof UserError) return { success: false, error: e.message };
  const message = e instanceof Error ? e.message : String(e);
  if (message.startsWith("Forbidden")) {
    return { success: false, error: "המסך הזה זמין רק כשהחברה הפעילה מוכרת טיולים. החליפו חברה בסרגל העליון." };
  }
  if (message.startsWith("Unauthorized")) return { success: false, error: "אין הרשאה לפעולה הזו." };
  console.error("tours-series-actions:", e);
  return { success: false, error: `הפעולה נכשלה: ${message}` };
}

const ok = <T>(data: T): ActionResult<T> => ({ success: true, data });

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

async function fetchAll<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += TOURS_PAGE_SIZE) {
    const { data, error } = await page(from, from + TOURS_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < TOURS_PAGE_SIZE) return out;
  }
}

const must = <T>(result: { data: T; error: { message: string } | null }): T => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SERIES_SELECT =
  "id, code, label, package_id, arrival_airport, arrival_weekday, return_airport, return_weekday, default_nights, default_capacity, default_currency, child_max_age, senior_min_age, senior_discount, is_active";

const intIn = (value: unknown, min: number, max: number, label: string): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new UserError(`${label}: ערך לא תקין`);
  return n;
};

// ---------------------------------------------------------------- list
export async function getSeriesScreen(): Promise<ActionResult<SeriesScreenData>> {
  try {
    const { company } = await requireCompany("tours");
    const db = toursDb();
    const today = todayIso();
    const [series, packages, terms, links, departures, periods] = await Promise.all([
      fetchAll<BoardSeries>((from, to) =>
        db.from("series").select(SERIES_SELECT).eq("company_id", company.id).order("code").range(from, to),
      ),
      fetchAll<BoardPackage>((from, to) =>
        db
          .from("packages")
          .select("id, name, kind, slug")
          .eq("company_id", company.id)
          .is("is_deleted", null)
          .order("name")
          .range(from, to),
      ),
      fetchAll<{ id: string; kind: string; name: string }>((from, to) =>
        db
          .from("terms")
          .select("id, kind, name")
          .eq("company_id", company.id)
          .in("kind", [...SERIES_TERM_KINDS])
          .eq("is_active", true)
          .order("position")
          .order("name")
          .range(from, to),
      ),
      // series_terms carries no company_id: reach it through the company's series.
      fetchAll<{ series_id: string; term_id: string; series: { company_id: string } }>((from, to) =>
        db
          .from("series_terms")
          .select("series_id, term_id, series!inner(company_id)")
          .eq("series.company_id", company.id)
          .order("series_id")
          .order("term_id")
          .range(from, to),
      ),
      fetchAll<{ series_id: string; end_date: string }>((from, to) =>
        db
          .from("departures")
          .select("series_id, end_date")
          .eq("company_id", company.id)
          .is("is_deleted", null)
          .order("id")
          .range(from, to),
      ),
      fetchAll<BoardPeriod>((from, to) =>
        supabaseTyped
          .from("calendar_periods")
          .select("id, name, kind, year, holiday_date, start_date, end_date")
          .or(`company_id.eq.${company.id},company_id.is.null`)
          .order("year")
          .order("id")
          .range(from, to),
      ),
    ]);

    const termIds = new Map<string, string[]>();
    for (const l of links) termIds.set(l.series_id, [...(termIds.get(l.series_id) ?? []), l.term_id]);
    const counts = new Map<string, { all: number; upcoming: number }>();
    for (const d of departures) {
      const c = counts.get(d.series_id) ?? { all: 0, upcoming: 0 };
      c.all += 1;
      if (d.end_date >= today) c.upcoming += 1;
      counts.set(d.series_id, c);
    }
    const rows: SeriesListRow[] = series.map((s) => ({
      ...s,
      termIds: termIds.get(s.id) ?? [],
      departures: counts.get(s.id)?.all ?? 0,
      upcoming: counts.get(s.id)?.upcoming ?? 0,
    }));
    return ok({
      series: rows,
      packages,
      terms: terms.map((t): SeriesTerm => ({ id: t.id, kind: t.kind as SeriesTermKind, name: t.name })),
      periods,
    });
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- save
/** Create (id = null) or edit a series, including its audience / tag / destination terms. */
export async function saveSeries(id: string | null, input: SeriesInput): Promise<ActionResult<{ id: string }>> {
  try {
    const { company } = await requireCompany("tours");
    const db = toursDb();
    if (id !== null && !UUID.test(id)) throw new UserError("הסדרה לא נמצאה");

    const code = String(input.code ?? "").trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]{1,7}$/.test(code)) {
      throw new UserError("קוד סדרה: 2 עד 8 תווים, אותיות באנגלית וספרות, מתחיל באות (למשל BBC)");
    }
    const arrival = normalizeAirport(input.arrival_airport);
    const ret = normalizeAirport(input.return_airport);
    if (arrival === undefined || ret === undefined) throw new UserError("קוד שדה תעופה הוא שלוש אותיות באנגלית (למשל LHR)");
    if (!(CURRENCIES as readonly string[]).includes(input.default_currency)) throw new UserError("מטבע לא נתמך");
    const childMaxAge = intIn(input.child_max_age, 0, 25, "גיל ילד מרבי");
    if (childMaxAge === null) throw new UserError("גיל ילד מרבי הוא שדה חובה (ברירת המחדל 16)");
    const discount = input.senior_discount === null || input.senior_discount === undefined ? null : Number(input.senior_discount);
    if (discount !== null && (!Number.isFinite(discount) || discount < 0 || discount > 100_000)) {
      throw new UserError("הנחת ותיק: ערך לא תקין");
    }

    let packageId: string | null = null;
    if (input.package_id) {
      if (!UUID.test(input.package_id)) throw new UserError("העמוד לא נמצא");
      const pkg = must(
        await db.from("packages").select("id").eq("company_id", company.id).eq("id", input.package_id).maybeSingle(),
      );
      if (!pkg) throw new UserError("העמוד לא נמצא בחברה הפעילה");
      packageId = pkg.id;
    }

    const wantedTerms = Array.from(new Set((input.termIds ?? []).filter((t) => UUID.test(t))));
    if (wantedTerms.length) {
      const found =
        must(
          await db
            .from("terms")
            .select("id")
            .eq("company_id", company.id)
            .in("kind", [...SERIES_TERM_KINDS])
            .in("id", wantedTerms),
        ) ?? [];
      if (found.length !== wantedTerms.length) throw new UserError("אחת התגיות לא שייכת לחברה הפעילה");
    }

    const row = {
      code,
      label: (input.label ?? "").trim().slice(0, 120) || null,
      package_id: packageId,
      arrival_airport: arrival,
      arrival_weekday: intIn(input.arrival_weekday, 0, 6, "יום נחיתה"),
      return_airport: ret,
      return_weekday: intIn(input.return_weekday, 0, 6, "יום חזרה"),
      default_nights: intIn(input.default_nights, 0, 60, "לילות"),
      default_capacity: intIn(input.default_capacity, 0, 2000, "קיבולת"),
      default_currency: input.default_currency,
      child_max_age: childMaxAge,
      senior_min_age: intIn(input.senior_min_age, 40, 120, "גיל ותיק מזערי"),
      senior_discount: discount,
      is_active: Boolean(input.is_active),
    };

    let seriesId = id;
    if (id) {
      const current = must(await db.from("series").select("id, code").eq("company_id", company.id).eq("id", id).maybeSingle());
      if (!current) throw new UserError("הסדרה לא נמצאה בחברה הפעילה");
      if (current.code !== code) {
        const { count } = await db
          .from("departures")
          .select("id", { count: "exact", head: true })
          .eq("company_id", company.id)
          .eq("series_id", id);
        if ((count ?? 0) > 0) {
          throw new UserError(`לסדרה יש ${count} יציאות שהקוד שלהן נבנה מ-${current.code}. אי אפשר לשנות את קוד הסדרה.`);
        }
      }
      const { error } = await db.from("series").update(row).eq("company_id", company.id).eq("id", id);
      if (error) {
        if (error.code === "23505") throw new UserError(`כבר קיימת סדרה עם הקוד ${code}`);
        throw new Error(error.message);
      }
    } else {
      const { data: inserted, error } = await db
        .from("series")
        .insert({ ...row, company_id: company.id })
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505") throw new UserError(`כבר קיימת סדרה עם הקוד ${code}`);
        throw new Error(error.message);
      }
      seriesId = inserted.id;
    }
    const savedId = seriesId as string;

    // Terms: the series row above was matched by company, so its links are this company's.
    const currentLinks = must(await db.from("series_terms").select("term_id").eq("series_id", savedId)) ?? [];
    const have = new Set(currentLinks.map((l) => l.term_id));
    const want = new Set(wantedTerms);
    const toRemove = [...have].filter((t) => !want.has(t));
    const toAdd = wantedTerms.filter((t) => !have.has(t));
    if (toRemove.length) must(await db.from("series_terms").delete().eq("series_id", savedId).in("term_id", toRemove));
    if (toAdd.length) must(await db.from("series_terms").insert(toAdd.map((term_id) => ({ series_id: savedId, term_id }))));

    await logAudit({
      action: id ? "update" : "create",
      entityType: "tours_series",
      entityId: savedId,
      changes: { ...row, terms_added: toAdd, terms_removed: toRemove },
      metadata: { company_id: company.id, code },
    });
    return ok({ id: savedId });
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- season duplication
/** What the season dialog needs about one series: its departures (copy sources) and the codes already taken. */
export async function getSeasonContext(seriesId: string): Promise<ActionResult<SeasonContext>> {
  try {
    const { company } = await requireCompany("tours");
    if (!UUID.test(seriesId)) throw new UserError("הסדרה לא נמצאה");
    const db = toursDb();
    const series = must(await db.from("series").select("id, code").eq("company_id", company.id).eq("id", seriesId).maybeSingle());
    if (!series) throw new UserError("הסדרה לא נמצאה בחברה הפעילה");

    const [own, taken] = await Promise.all([
      fetchAll((from, to) =>
        db
          .from("departures")
          .select(
            "id, code, season_year, start_date, end_date, currency, season, is_deleted, departure_prices(room_position), departure_options(id), promotions(id, is_active)",
          )
          .eq("company_id", company.id)
          .eq("series_id", seriesId)
          .order("start_date", { ascending: false })
          .order("id")
          .range(from, to),
      ),
      // Codes are unique per company and year, whatever the series - check every code that could collide.
      fetchAll<{ code: string; season_year: number }>((from, to) =>
        db
          .from("departures")
          .select("code, season_year")
          .eq("company_id", company.id)
          .like("code", `${series.code}%`)
          .order("id")
          .range(from, to),
      ),
    ]);
    const existing: SeasonExistingDeparture[] = own.map((d) => ({
      id: d.id,
      code: d.code,
      season_year: d.season_year,
      start_date: d.start_date,
      end_date: d.end_date,
      currency: d.currency,
      season: d.season,
      is_deleted: d.is_deleted,
      priceRows: d.departure_prices.length,
      optionRows: d.departure_options.length,
      activePromotions: d.promotions.filter((p) => p.is_active).length,
    }));
    return ok({ existing, takenCodes: taken.map((t) => `${t.code}:${t.season_year}`) });
  } catch (e) {
    return fail(e);
  }
}

const MAX_SEASON_ITEMS = 120;

/**
 * Create the departures the operator ticked in the season dialog. Each one is
 * a draft: not published, route / capacity from the series, code from the
 * series code and the date. A code that already exists is skipped. Prices
 * (matrix, or hotels + tickets + markup of a vacation package) and active
 * promotions can be copied from one existing departure of the same series.
 */
export async function createSeasonDepartures(input: SeasonCreateInput): Promise<ActionResult<SeasonCreateResult>> {
  try {
    const { company } = await requireCompany("tours");
    const db = toursDb();
    if (!UUID.test(input.seriesId ?? "")) throw new UserError("בחרו סדרה");
    const items = Array.isArray(input.items) ? input.items : [];
    if (items.length === 0) throw new UserError("לא סומנו יציאות ליצירה");
    if (items.length > MAX_SEASON_ITEMS) throw new UserError(`אפשר ליצור עד ${MAX_SEASON_ITEMS} יציאות בפעם אחת`);
    for (const item of items) {
      if (!isIsoDate(item.start_date) || !isIsoDate(item.end_date) || item.end_date < item.start_date) {
        throw new UserError("תאריך לא תקין באחת היציאות");
      }
      if ((nightsBetween(item.start_date, item.end_date) ?? 0) > 60) throw new UserError("טיול של יותר מ-60 לילות - בדקו את מספר הלילות");
    }

    const series = must(
      await db.from("series").select(SERIES_SELECT).eq("company_id", company.id).eq("id", input.seriesId).maybeSingle(),
    );
    if (!series) throw new UserError("הסדרה לא נמצאה בחברה הפעילה");
    if (!series.package_id) throw new UserError(`לסדרה ${series.code} אין עמוד באתר. שייכו אותה לעמוד ואז צרו יציאות.`);

    const copying = Boolean(input.copyFromDepartureId) && (input.copyPrices || input.copyPromotions);
    let source: {
      id: string;
      code: string;
      currency: string;
      flight_mode: string;
      flight_price: number;
      markup_percent: number | null;
      markup_fixed: number | null;
    } | null = null;
    if (copying) {
      if (!UUID.test(input.copyFromDepartureId ?? "")) throw new UserError("יציאת המקור לא נמצאה");
      source = must(
        await db
          .from("departures")
          .select("id, code, currency, flight_mode, flight_price, markup_percent, markup_fixed")
          .eq("company_id", company.id)
          .eq("series_id", series.id)
          .eq("id", input.copyFromDepartureId as string)
          .maybeSingle(),
      );
      if (!source) throw new UserError("יציאת המקור לא שייכת לסדרה הזו");
    }
    const copyPrices = Boolean(source && input.copyPrices);
    const copyPromotions = Boolean(source && input.copyPromotions);

    // What is already taken (deleted departures hold their code too).
    const wanted = items.map((item) => ({
      ...item,
      code: departureCode(series.code, item.start_date),
      season_year: seasonYearOf(item.start_date),
    }));
    const taken = new Set<string>();
    for (const part of chunk(Array.from(new Set(wanted.map((w) => w.code))), 100)) {
      const rows =
        must(await db.from("departures").select("code, season_year").eq("company_id", company.id).in("code", part)) ?? [];
      for (const r of rows) taken.add(`${r.code}:${r.season_year}`);
    }
    const result: SeasonCreateResult = { created: [], skipped: [] };
    const fresh: typeof wanted = [];
    for (const w of wanted) {
      const key = `${w.code}:${w.season_year}`;
      if (taken.has(key)) {
        result.skipped.push({ code: w.code, reason: `כבר קיימת יציאה עם הקוד הזה בשנת ${w.season_year}` });
        continue;
      }
      taken.add(key);
      fresh.push(w);
    }
    if (fresh.length === 0) return ok(result);

    const season = (input.season ?? "").trim().slice(0, 60) || null;
    const inserted =
      must(
        await db
          .from("departures")
          .insert(
            fresh.map((w) => ({
              company_id: company.id,
              package_id: series.package_id as string,
              series_id: series.id,
              code: w.code,
              season_year: w.season_year,
              start_date: w.start_date,
              end_date: w.end_date,
              season,
              currency: copyPrices && source ? source.currency : series.default_currency,
              arrival_airport: series.arrival_airport,
              return_airport: series.return_airport,
              capacity: series.default_capacity,
              is_published: false,
              sale_status: "open",
              ...(copyPrices && source
                ? {
                    flight_mode: source.flight_mode,
                    flight_price: source.flight_price,
                    markup_percent: source.markup_percent,
                    markup_fixed: source.markup_fixed,
                  }
                : {}),
            })),
          )
          .select("id, code, start_date"),
      ) ?? [];
    result.created = inserted;
    const newIds = inserted.map((d) => d.id);

    if (source && copyPrices) {
      const [prices, options] = await Promise.all([
        db.from("departure_prices").select("pax_type, room_position, price").eq("company_id", company.id).eq("departure_id", source.id),
        db
          .from("departure_options")
          .select("kind, position, ref_code, label, board, nights, stay_order, max_people, price, price_unit, room_prices")
          .eq("company_id", company.id)
          .eq("departure_id", source.id),
      ]);
      const priceRows = newIds.flatMap((departure_id) =>
        (must(prices) ?? []).map((p) => ({ ...p, departure_id, company_id: company.id })),
      );
      for (const part of chunk(priceRows, 500)) must(await db.from("departure_prices").insert(part));
      const optionRows = newIds.flatMap((departure_id) =>
        (must(options) ?? []).map((o) => ({ ...o, departure_id, company_id: company.id })),
      );
      for (const part of chunk(optionRows, 500)) must(await db.from("departure_options").insert(part));
    }
    if (source && copyPromotions) {
      const today = todayIso();
      const promotions =
        must(
          await db
            .from("promotions")
            .select("kind, value, label, valid_until, show_on_card")
            .eq("company_id", company.id)
            .eq("departure_id", source.id)
            .eq("is_active", true),
        ) ?? [];
      const rows = newIds.flatMap((departure_id) =>
        promotions.map((p) => ({
          ...p,
          // An expiry date that already passed belongs to the season it was copied from.
          valid_until: p.valid_until && p.valid_until >= today ? p.valid_until : null,
          is_active: true,
          departure_id,
          company_id: company.id,
        })),
      );
      for (const part of chunk(rows, 500)) must(await db.from("promotions").insert(part));
    }

    await logAudit({
      action: "create",
      entityType: "tours_departure",
      entityId: null,
      metadata: {
        company_id: company.id,
        series_id: series.id,
        series_code: series.code,
        season_duplication: true,
        codes: inserted.map((d) => d.code),
        count: inserted.length,
        copied_from: source?.code ?? null,
        copy_prices: copyPrices,
        copy_promotions: copyPromotions,
      },
    });
    return ok(result);
  } catch (e) {
    return fail(e);
  }
}
