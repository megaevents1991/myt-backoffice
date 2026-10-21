/**
 * Tour uploader (agent #3) - what earlier runs and the venue templates say. Spec:
 * docs/superpowers/specs/2026-10-21-tour-uploader-agent-design.md sections 8.4 (prior answers),
 * 9.3 (venue templates) and the plan card's markups.
 *
 * `loadPriorItems` (answered questions + final rejections of earlier runs of a subject),
 * `priorMarkups` (the newest real run's markups) and `venueMapFor` (a supplier drawing's
 * `venue_maps` template). Every failed read THROWS. Session-free: the server actions own the guard.
 * Never writes.
 */
// Never in a client bundle (Next resolves "server-only" itself; no tsx script imports this module).
import "server-only";
import { supabase, supabaseTyped } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";
import { normalizeName } from "@/lib/on-tour";
import { urlSpellings } from "@/lib/services/venue-memory";
import { priorItemsOf, priorRunScope, type PriorItem, type PriorItemRow, type PriorRunRow } from "@/lib/uploader/shows";
import type { SupplierCategoryMap, VenueMap, VenueZone } from "@/lib/venue-maps/svg-zones";
import type { Json } from "@/types/database.types";
import type { SubjectKind, UploaderPlan } from "@/types/uploader.types";

// `uploader_runs` / `uploader_items` are newer than types/database.types.ts (`npm run db:types`
// after migration 20261021115818) - one boundary cast for them and `user_profiles`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** The most rows one read may page through; past it the read THROWS rather than return a part. */
const ROWS_MAX = 20_000;
/** Ids per `.in()` filter - keeps the request line well inside URL limits. */
const IN_CHUNK = 200;

type JsonObject = { [key: string]: Json | undefined };
const isObject = (v: Json | undefined): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: Json | undefined): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

const chunks = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

function fail(what: string, error: { message: string } | null): never {
  console.error(`uploader-prior: ${what} failed`, JSON.stringify(error));
  throw new Error(`${what} failed: ${error?.message ?? "unknown error"}`);
}

// ---- prior runs ----------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Display names for answerers stored by user id (anything else is printed as it is). */
async function displayNames(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = [...new Set(ids.filter((id) => UUID.test(id)))];
  for (const part of chunks(wanted, IN_CHUNK)) {
    const { data, error } = await db.from("user_profiles").select("id,email,display_name").in("id", part);
    if (error) fail("user_profiles read", error);
    for (const p of (data ?? []) as { id: string; email: string | null; display_name: string | null }[]) {
      out.set(p.id, p.display_name || p.email || p.id);
    }
  }
  return out;
}

/**
 * What earlier runs of this subject settled: every ANSWERED question (its kind, key and answer) and
 * every show rejected for good (`kind: "rejected"`, keyed by `questionKey` of the item's show), with
 * the run's number (1 = the first run ever, by creation) and who answered. The subject matches by
 * `normalizeName`, as `priorAnswerFor` / `priorRejectionFor` compare it. `includeTest` = the asking
 * run's own `is_test`: a REAL run learns from real runs only (a test run's rejections - the how-to
 * tells staff to reject the test events - must never skip a show on a real run); a test run reads
 * both. The scope and the mapping are the pure `priorRunScope` / `priorItemsOf` (lib/uploader/shows.ts).
 */
export async function loadPriorItems(subject_en: string, opts: { includeTest: boolean }): Promise<PriorItem[]> {
  if (normalizeName(subject_en) === "") return [];
  const runs = await fetchPaged<PriorRunRow & { created_at: string }>(
    () => db.from("uploader_runs").select("id,created_at,plan,is_test").order("created_at").order("id"),
    ROWS_MAX,
  );
  if (runs.error || runs.truncated) fail("uploader_runs read", runs.error ?? { message: "too many rows" });
  const scope = priorRunScope(runs.rows, subject_en, opts.includeTest);
  if (scope.runIds.length === 0) return [];

  const items: (PriorItemRow & { id: string })[] = [];
  for (const part of chunks(scope.runIds, IN_CHUNK)) {
    const read = await fetchPaged<PriorItemRow & { id: string }>(
      () =>
        db
          .from("uploader_items")
          .select("id,run_id,show,question,rejected_final,rejected_reason")
          .in("run_id", part)
          .or("rejected_final.eq.true,question.not.is.null")
          .order("id"),
      ROWS_MAX,
    );
    if (read.error || read.truncated) fail("uploader_items read", read.error ?? { message: "too many rows" });
    items.push(...read.rows);
  }

  const names = await displayNames(items.flatMap((i) => (i.question?.answer?.by ? [i.question.answer.by] : [])));
  return priorItemsOf(items, scope, names);
}

/** The markups of the newest real (not rehearsal) run about a subject of this kind - `applyPriorDefaults`' input. */
export async function priorMarkups(kind: SubjectKind): Promise<{ ticket_only: number | null; additional: number | null } | null> {
  const { data, error } = await db
    .from("uploader_runs")
    .select("plan")
    .eq("plan->subject->>kind", kind)
    .eq("is_test", false)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) fail("uploader_runs (markups) read", error);
  const plan = ((data ?? []) as { plan: UploaderPlan | null }[])[0]?.plan;
  if (!plan?.markups) return null;
  return { ticket_only: plan.markups.ticket_only ?? null, additional: plan.markups.additional ?? null };
}

// ---- venue template ------------------------------------------------------------------------------

function zonesOf(v: Json): VenueZone[] {
  if (!Array.isArray(v)) return [];
  const out: VenueZone[] = [];
  for (const z of v) {
    if (!isObject(z)) continue;
    const id = text(z.id);
    const label = text(z.label);
    const sections = Array.isArray(z.sections) ? z.sections.filter((s): s is string => typeof s === "string") : [];
    if (id && label) out.push({ id, label, sections });
  }
  return out;
}

function supplierCategoriesOf(v: Json): SupplierCategoryMap {
  const out: SupplierCategoryMap = {};
  if (!isObject(v)) return out;
  for (const [supplier, map] of Object.entries(v)) {
    if (!isObject(map)) continue;
    const entries = Object.entries(map).filter((e): e is [string, string] => typeof e[1] === "string");
    out[supplier] = Object.fromEntries(entries);
  }
  return out;
}

/**
 * The venue template (`venue_maps`) of a supplier drawing, matched on `source_url` in any of the
 * spellings a URL is stored under ("Royal Albert Hall" / "Royal%20Albert%20Hall"). null = a venue
 * we have no template for (the build warns `new_venue`).
 */
export async function venueMapFor(sourceUrl: string | null): Promise<Pick<VenueMap, "svg_url" | "zones" | "supplier_categories"> | null> {
  const url = (sourceUrl ?? "").trim();
  if (url === "") return null;
  // A spelling holding `"` would break out of PostgREST's quoted `in.(...)` list - a supplier URL never has one.
  const spellings = urlSpellings(url).filter((u) => !u.includes('"'));
  if (spellings.length === 0) return null;
  const { data, error } = await supabaseTyped
    .from("venue_maps")
    .select("svg_url,zones,supplier_categories")
    .in("source_url", spellings)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) fail("venue_maps read", error);
  const row = data?.[0];
  if (!row) return null;
  return { svg_url: row.svg_url, zones: zonesOf(row.zones), supplier_categories: supplierCategoriesOf(row.supplier_categories) };
}
