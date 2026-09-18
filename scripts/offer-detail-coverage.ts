/**
 * How often does the comparison sheet actually know what a competitor's package CONTAINS?
 * Read-only: per competitor, how many listings carry a detail text and how many of those the
 * parsers in lib/services/offer-detail.ts turn into a flight / hotel / ticket line.
 * `--matched` narrows to listings an event is matched against (what staff see in the sheet);
 * `--samples N` prints N detail texts per competitor that yielded no flight line.
 *
 * Run: npx tsx --env-file=.env.local scripts/offer-detail-coverage.ts [--matched] [--samples 3]
 */
import { createClient } from "@supabase/supabase-js";
import { formatOfferLines, parseOfferDetail } from "../lib/services/offer-detail";
import type { CompetitorKey, ExtractedAttrs } from "../types/price-light.types";

type Row = { id: number; competitor: CompetitorKey; scope: string; title: string | null; url: string | null; detail_text: string | null; attrs: Partial<ExtractedAttrs> | null };

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_SECRET_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("missing supabase env");
const db = createClient(url, key, { auth: { persistSession: false } });

const matchedOnly = process.argv.includes("--matched");
const samplesAt = process.argv.indexOf("--samples");
const samples = samplesAt >= 0 ? Number(process.argv[samplesAt + 1]) || 0 : 0;

async function page<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(JSON.stringify(error));
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}

async function main(): Promise<void> {
  let ids: Set<number> | null = null;
  if (matchedOnly) {
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const matches = await page<{ listing_id: number | null }>((from, to) =>
      db.from("competitor_matches").select("listing_id").eq("status", "found").gte("created_at", since).order("id").range(from, to));
    ids = new Set(matches.map((m) => m.listing_id).filter((id): id is number => id != null));
  }
  const listings = (await page<Row>((from, to) =>
    db.from("competitor_listings").select("id,competitor,scope,title,url,detail_text,attrs").order("id").range(from, to)))
    .filter((l) => (ids ? ids.has(l.id) : true));

  const stats = new Map<string, { total: number; text: number; flight: number; times: number; hotel: number; ticket: number; misses: Row[] }>();
  for (const l of listings) {
    const k = `${l.competitor}/${l.scope}`;
    const s = stats.get(k) ?? { total: 0, text: 0, flight: 0, times: 0, hotel: 0, ticket: 0, misses: [] };
    stats.set(k, s);
    s.total++;
    if ((l.detail_text ?? "").trim().length > 0) s.text++;
    const parsed = parseOfferDetail(l.competitor, l.detail_text, l.attrs);
    const lines = formatOfferLines(parsed);
    if (lines.flight) s.flight++;
    if (parsed.flight?.out || parsed.flight?.back) s.times++;
    if (lines.hotel) s.hotel++;
    if (lines.ticket) s.ticket++;
    if (!lines.flight && (l.detail_text ?? "").length > 0 && s.misses.length < samples) s.misses.push(l);
  }

  console.log(matchedOnly ? "listings matched to an event in the last 14 days" : "all stored listings");
  console.table([...stats.entries()].sort().map(([k, s]) => ({
    competitor: k, total: s.total, detail_text: s.text, flight: s.flight, flight_times: s.times, hotel: s.hotel, ticket: s.ticket,
  })));
  for (const [k, s] of stats) {
    for (const m of s.misses) console.log(`\n--- ${k} #${m.id} ${m.url}\n${(m.detail_text ?? "").slice(0, 1500)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
