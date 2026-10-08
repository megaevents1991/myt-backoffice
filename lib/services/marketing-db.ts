/* eslint-disable @typescript-eslint/no-explicit-any */
// The ONE untyped boundary for the marketing tables (types/marketing.types.ts carries the
// shapes) until `npm run db:types` is rerun after migration 20261008120000 is applied.
import { supabase } from "@/lib/supabase-server";

export const mdb = supabase as any;

const PAGE = 1000;

/** A table that does not exist (its migration is not applied yet): Postgres 42P01, or PostgREST's schema cache PGRST205. Nothing else. */
export const isMissingRelation = (e: unknown): boolean => {
  const code = (e as { code?: unknown } | null | undefined)?.code;
  return code === "42P01" || code === "PGRST205";
};

/**
 * Every row of `table` that `filter` keeps, read page by page in `orderBy` order - a plain select answers
 * 1,000 rows at most and says nothing, so a single read would be a silent first page. `orderBy` must be a
 * stable order (the table's key) and every one of its columns must be in `select`: offset paging can serve
 * a row twice when a write lands between two pages, so rows are deduped by those columns joined (a composite
 * key). THROWS on any read error (`<label> read <table>: ...`) and past `max` rows - a short list must never
 * pass for the whole table. `db` exists for the selftest's fake (scripts/marketing-alerts-selftest.ts).
 * Shared by lib/actions/marketing-actions.ts, lib/services/marketing-alerts.ts and the sync's click walk.
 */
export async function readAll<T>(
  table: string,
  select: string,
  orderBy: string[],
  max: number,
  label: string,
  filter: (q: any) => any = (q) => q,
  db: any = mdb,
): Promise<T[]> {
  const seen = new Set<string>();
  const out: T[] = [];
  for (let offset = 0; offset < max; offset += PAGE) {
    let q = filter(db.from(table).select(select));
    for (const col of orderBy) q = q.order(col);
    const { data, error } = await q.range(offset, offset + PAGE - 1);
    // The PostgREST / Postgres code rides on the Error, so a caller can tell a missing table (42P01 / PGRST205) from the rest.
    if (error) throw Object.assign(new Error(`${label} read ${table}: ${error.message}`), { code: error.code as string | undefined });
    const page = (data ?? []) as Record<string, unknown>[];
    for (const row of page) {
      const missing = orderBy.find((c) => !(c in row));
      if (missing) throw new Error(`${label} read ${table}: order column "${missing}" is not selected - rows cannot be deduped`);
      const key = orderBy.map((c) => String(row[c] ?? "")).join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row as T);
    }
    if (page.length < PAGE) return out;
  }
  throw new Error(`${label} read ${table}: more than ${max} rows`);
}
