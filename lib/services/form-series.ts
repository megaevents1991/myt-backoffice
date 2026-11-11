/**
 * Reads of the tours series / departures the feedback forms hang on (spec
 * docs/superpowers/specs/2026-10-21-forms-series-hotels-design.md). Session-free: every
 * caller is a forms action that already passed its own guard.
 *
 * Every read takes the company the form belongs to (2026-11-11 - the forms belong to a
 * company, spec docs/superpowers/specs/2026-11-11-forms-to-mega-family-design.md) and
 * answers only that company's series, departures and guides (`company_id` on
 * tours.series / tours.instructors; a departure belongs to its series). A company that sells
 * no tours (Mega Events) has none, so its forms get no series parts.
 */
import { toursDb } from "@/lib/tours/db";
import { fetchPaged } from "@/lib/supabase-paged";
import type { SeriesDeparture } from "@/lib/forms/series";
import type { FormSeries } from "@/types/form.types";

/** Every series of the company (or the ones asked for), with its tour's name, by code. */
export async function readSeries(companyId: string, ids?: string[]): Promise<FormSeries[]> {
  if (ids && ids.length === 0) return [];
  let query = toursDb()
    .from("series")
    .select("id,code,label,is_active,package_id")
    .eq("company_id", companyId)
    .order("code", { ascending: true });
  if (ids) query = query.in("id", ids);
  const { data, error } = await query;
  if (error) {
    console.error("readSeries failed:", JSON.stringify(error));
    throw new Error("Could not read the series");
  }
  const rows = data ?? [];

  const packageIds = [...new Set(rows.map((r) => r.package_id).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (packageIds.length > 0) {
    const { data: packages, error: packagesError } = await toursDb()
      .from("packages")
      .select("id,name")
      .in("id", packageIds);
    if (packagesError) {
      // A missing tour name is a label, not a reason to fail the screen.
      console.error("readSeries packages failed:", JSON.stringify(packagesError));
    }
    for (const p of packages ?? []) if (p.name) names.set(p.id, p.name);
  }

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: (r.package_id && names.get(r.package_id)) || r.label || null,
    is_active: r.is_active,
  }));
}

/** One series of the company, or null when the id is not one of its series. */
export async function readOneSeries(companyId: string, id: string): Promise<FormSeries | null> {
  const [series] = await readSeries(companyId, [id]);
  return series ?? null;
}

const DEPARTURES_MAX = 5000;

/**
 * The live departures of one series of the company - or of every series of the company when
 * `seriesId` is null (a general form like #5) - each with its series' code. Paged: the
 * catalog passes 1,000 in a season or two.
 */
export async function readSeriesDepartures(
  companyId: string,
  seriesId: string | null,
): Promise<SeriesDeparture[]> {
  const series = await readSeries(companyId, seriesId ? [seriesId] : undefined);
  if (series.length === 0) return [];
  const codeOf = new Map(series.map((s) => [s.id, s.code]));
  if (seriesId && !codeOf.has(seriesId)) return [];

  const { rows, error } = await fetchPaged<{
    id: string;
    code: string;
    start_date: string;
    end_date: string | null;
    series_id: string;
  }>(() => {
    let query = toursDb()
      .from("departures")
      .select("id,code,start_date,end_date,series_id")
      .is("is_deleted", null)
      .order("start_date", { ascending: true })
      .order("id", { ascending: true });
    // Every series: read them all and keep the company's below (codeOf) - an id list of
    // every series in the URL would outgrow PostgREST's request line.
    if (seriesId) query = query.eq("series_id", seriesId);
    return query;
  }, DEPARTURES_MAX);
  if (error) {
    console.error("readSeriesDepartures failed:", JSON.stringify(error));
    throw new Error("Could not read the departures");
  }

  return rows
    .filter((d) => codeOf.has(d.series_id))
    .map((d) => ({
      id: d.id,
      code: d.code,
      start_date: d.start_date,
      end_date: d.end_date,
      series_code: codeOf.get(d.series_id) ?? "",
    }));
}

/** One departure of the company's series with its series code, or null. */
export async function readDeparture(companyId: string, id: string): Promise<SeriesDeparture | null> {
  const { data, error } = await toursDb()
    .from("departures")
    .select("id,code,start_date,end_date,series_id")
    .eq("id", id)
    .is("is_deleted", null)
    .maybeSingle();
  if (error) {
    console.error("readDeparture failed:", JSON.stringify(error));
    throw new Error("Could not read the departure");
  }
  if (!data) return null;
  // A departure of another company's series is no departure of this form.
  const series = await readOneSeries(companyId, data.series_id);
  if (!series) return null;
  return {
    id: data.id,
    code: data.code,
    start_date: data.start_date,
    end_date: data.end_date,
    series_code: series.code,
    series_id: series.id,
  };
}

/** The company's guides' names (tours.instructors), offered as escort suggestions on a trip link. */
export async function readGuideNames(companyId: string): Promise<string[]> {
  const { data, error } = await toursDb()
    .from("instructors")
    .select("name")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("name", { ascending: true })
    .limit(1000);
  if (error) {
    console.error("readGuideNames failed:", JSON.stringify(error));
    return [];
  }
  return (data ?? []).map((r) => r.name).filter((n): n is string => Boolean(n?.trim()));
}
