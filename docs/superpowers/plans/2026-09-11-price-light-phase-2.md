# Price Light (רמזור) — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three more competitor crawlers (ISSTA Sport, Golasso, OnTour) feed the sports/music package lights, and the matcher accepts listings that publish a travel window instead of an event date.

**Architecture:** Each site gets one file in `lib/services/competitor-scrapers/` implementing the phase-0 `CompetitorScraper` interface (pure `parseCatalog`/`parseDetail` + a `crawl()` generator), registered in `index.ts` so `ACTIVE_COMPETITORS` picks them up without any other wiring. Shared HTML/date/price helpers move from `liveevents.ts` into `shared.ts`. The rule matcher (`price-light.ts` `pickRuleMatch`) and the candidate query (`price-light-match.ts` `candidatesFor`) learn a second way to be "on the date": `event_date IS NULL` and `travel_depart ≤ event.date ≤ travel_return`. Fixture regression moves to a per-site module under `scripts/fixture-checks/`.

**Tech Stack:** Next.js 15, TypeScript, `linkedom` (HTML parsing under plain node), `playwright-core` via `lib/services/browser.ts` (Golasso only), Supabase service-role with the `db = supabase as any` boundary cast.

**Spec:** `docs/superpowers/specs/2026-09-09-price-light-design.md` §2.3, §3, §4, §12 row 2. Site recon: `docs/superpowers/scrapers/phase2-recon.md` (selectors verbatim from there). Phase 0 (`0a64f20`, `1e01962`, `2751631`) + phase 1 (`14db65d`) are on the branch.

## Global Constraints

- **The light never touches pricing (Dor, 2026-09-11): the רמזור is IN ADDITION to the pricing brain, it does not replace it.** No task in this plan edits `lib/services/price-quote.ts`, `lib/services/base-price-sync.ts`, `lib/services/ticket-price-sync.ts`, `/price-changes`, or any `base_*`/markup column. `comp_pricing` stays as is (no removal). The light only READS our prices via `ourPackageUsd`/`ourTicketUsd`.
- **Never commit or push.** Each task ends with "stop and report"; the controller commits when Dor asks. No AI co-author lines.
- **Never apply migrations from the branch.** Task 2 only WRITES the migration file; it lands on master through the controller's plumbing push (the phase-0 route). `npm run db:push` stays blocked.
- **Worktree only:** `myt-backoffice/.claude/worktrees/feat-price-light`. No `cd` to the main checkout. Plain git commands only (a guard refuses compound/complex git).
- **Recon is the selector source.** Selectors, URLs and text markers come from `docs/superpowers/scrapers/phase2-recon.md`. When a live page disagrees with the recon, the fixture wins: fix the parser, and append an "Addendum" paragraph to the recon doc saying what differed (the phase-0 pattern in `liveevents.md`).
- **Parsers are pure and plain-node importable:** `parseCatalog`/`parseDetail`/`parseArtists`/`parsePerformer` take an HTML string and return `Listing`s; no `@/` imports at module top level (the scripts run under `node --experimental-strip-types`, which cannot resolve the alias); `toUsd` is dynamically imported inside `crawl()`/`detail()` only, exactly like `liveevents.ts`.
- **Stealth is code:** `stealthHeaders()` on every fetch; `ctx.pause()` (20–60 s) between browser page loads and between *sites*; the new `ctx.pauseShort()` (5–15 s) only between paginated GETs of the same site in fetch mode. Never more than one browser session per crawl. 240 s crawl budget (`CRAWL_BUDGET_MS`) and 300 s route `maxDuration` are unchanged — plan the GET count to fit (ISSTA ≤ 8 GETs, OnTour ≤ 11 GETs).
- **One listing = one `(competitor, external_key)`:** keys are stable across crawls (site id, never a position), unique within a crawl (dedupe with a `Set` when a listing appears on several catalog pages).
- **Null `event_date` is legal ONLY together with a full travel window** (`travel_depart` and `travel_return` both set). A listing with neither is dropped by the parser (logged as a count, not per row).
- **Money:** `price_from` is the site's per-person double-room number in the site's currency; `price_usd` = `Math.round(toUsd(price_from, currency))`; quote-only = `price_from: null, currency: null, price_usd: null` (the matcher already turns that into `unsure` / `quote_only`).
- **Supabase standard:** explicit selects, check `error` first, `console.error(JSON.stringify(error))`, one `const db = supabase as any` per file, no other `any`, no unguarded `!`.
- **Type gate:** `npx tsc --noEmit` clean; lint = `ESLINT_USE_FLAT_CONFIG=false npx eslint --no-eslintrc --config .eslintrc.json --resolve-plugins-relative-to . <files>` (the worktree's `next lint` is broken by a parent-config collision). Selftest = `node scripts/price-light-selftest.ts`. Fixture regression = `node scripts/scrape-fixture.ts <site>`.
- **Network from a task = fixture save only** (`--save`, one visit per fixture page, 20 s apart). No task runs a full live crawl against a competitor.
- **`/guide` + `CLAUDE.md`** updated in Task 7 (competitor list is a staff-visible fact).

---

## File map

| File | Responsibility |
| --- | --- |
| `lib/services/price-light.ts` | `MatchCandidate` gains `travel_depart`/`travel_return`; `candidateCoversDate()`; `pickRuleMatch` uses it |
| `lib/services/price-light-match.ts` | `candidatesFor` OR-clause for window listings; passes the window into `MatchCandidate` |
| `lib/services/price-light-judge.ts` | candidate line shows the window when `event_date` is null |
| `lib/services/price-light-crawl.ts` | `listingChanged` compares the window too; `ctx.pauseShort` |
| `lib/services/price-light-tasks.ts` | unique-violation (23505) on insert → return the existing task |
| `supabase/migrations/20260911100000_price_light_phase2.sql` | window index + one-open-task unique index |
| `lib/services/browser.ts` | `shortPause()`, `PAUSE_SHORT_MIN_MS/MAX_MS` |
| `lib/services/competitor-scrapers/types.ts` | `CrawlContext.pauseShort` |
| `lib/services/competitor-scrapers/shared.ts` | `doc`, `isoOrNull`, `parseHeDate`, `parsePrice`, `currencyFromSymbol`, `stealthHeaders`, `nightsBetween`, `flatText`, `textLines`, `absoluteUrl` (moved out of `liveevents.ts`) |
| `lib/services/competitor-scrapers/liveevents.ts` | imports the helpers from `shared.ts`, re-exports the three the fixture check uses |
| `lib/services/competitor-scrapers/issta.ts` | fetch-mode crawler, 8 league pages, microdata |
| `lib/services/competitor-scrapers/ontour.ts` | fetch-mode crawler, `/artists/` → performer pages |
| `lib/services/competitor-scrapers/golasso.ts` | browser-mode crawler, all-packages page + fetchable `/pdetails/<id>` |
| `lib/services/competitor-scrapers/index.ts` | registration order liveevents, issta, golasso, ontour, livetickets |
| `scripts/scrape-fixture.ts`, `scripts/fixture-checks/{types,liveevents,issta,ontour,golasso}.ts` | per-site fixture save + assertions |
| `scripts/scrape-once.ts` | `pauseShort` in its context |
| `scripts/price-light-selftest.ts` | window-match assertions |
| `scripts/fixtures/{issta,ontour,golasso}/*.html` | saved fixtures |
| `app/(dashboard)/events/price-light-ui.tsx`, `app/(dashboard)/price-light/competitors-panel.tsx` | `COMPETITOR_LABEL` display names |
| `CLAUDE.md`, `app/(dashboard)/guide/guide-content.ts`, `docs/superpowers/scrapers/phase2-recon.md` | docs |

---

### Task 1: Travel-window matching (engine + candidate query + judge prompt + crawl change-detection)

**Files:**
- Modify: `lib/services/price-light.ts` (`MatchCandidate`, `pickRuleMatch`, new `candidateCoversDate`)
- Modify: `scripts/price-light-selftest.ts`
- Modify: `lib/services/price-light-match.ts` (`candidatesFor`, the `MatchCandidate` mapping)
- Modify: `lib/services/price-light-judge.ts` (candidate `head` line)
- Modify: `lib/services/price-light-crawl.ts` (`listingChanged` + its select)

**Interfaces:**
- Consumes: `ListingRow.travel_depart/travel_return: string | null` (`types/price-light.types.ts`), `DATE_TOLERANCE_DAYS`.
- Produces: `export function candidateCoversDate(c: MatchCandidate, date: string): boolean`; `MatchCandidate { id; title; title_he?; event_date: string | null; travel_depart?: string | null; travel_return?: string | null }`. Tasks 4–6 rely on the matcher accepting `event_date: null` + window.

- [ ] **Step 1: Write the failing selftest cases**

Append to `scripts/price-light-selftest.ts` right after the existing `pickRuleMatch` block (before the `signedUsd` asserts):

```ts
// window listings (phase 2): no event_date, the travel window must contain our date
const winCands = [
  { id: 10, title: "ברצלונה-ריאל מדריד", event_date: null, travel_depart: "2026-10-23", travel_return: "2026-10-27" },
  { id: 11, title: "Real Madrid vs Barcelona", event_date: null, travel_depart: "2026-11-01", travel_return: "2026-11-04" },
  { id: 12, title: "Real Madrid vs Barcelona", event_date: null, travel_depart: null, travel_return: null }, // no window, no date -> never
];
assert.equal(candidateCoversDate(winCands[0], "2026-10-26"), true);
assert.equal(candidateCoversDate(winCands[0], "2026-10-23"), true);  // inclusive both ends
assert.equal(candidateCoversDate(winCands[0], "2026-10-28"), false);
assert.equal(candidateCoversDate(winCands[2], "2026-10-26"), false);
assert.equal(candidateCoversDate({ id: 1, title: "x", event_date: "2026-10-26", travel_depart: "2026-10-20", travel_return: "2026-10-30" }, "2026-10-27"), false); // a dated listing is date-only, window ignored
const winPick = pickRuleMatch({ names: ["Real Madrid vs Barcelona", "ריאל מדריד ברצלונה"], date: "2026-10-26" }, winCands);
assert.equal(winPick?.candidate.id, 10);
assert.equal(pickRuleMatch({ names: ["Real Madrid vs Barcelona"], date: "2026-10-30" }, winCands), null); // outside every window
assert.equal(pickRuleMatch({ names: ["Real Madrid vs Barcelona"], date: "2026-11-02" }, winCands)?.candidate.id, 11);
```

Add `candidateCoversDate` to the import list at the top of the selftest.

- [ ] **Step 2: Run it to see it fail**

Run: `node scripts/price-light-selftest.ts`
Expected: FAIL — `candidateCoversDate` is not exported.

- [ ] **Step 3: Implement in `lib/services/price-light.ts`**

Replace the `MatchCandidate` interface and `pickRuleMatch` with:

```ts
export interface MatchCandidate {
  id: number;
  title: string;
  title_he?: string | null;
  event_date: string | null;
  /** Phase 2: sites that publish a travel window instead of the match date (ISSTA, OnTour). */
  travel_depart?: string | null;
  travel_return?: string | null;
}

/**
 * A candidate is "on our date" either by exact event_date, or — when the site publishes no
 * event date at all — because its travel window contains our date (inclusive both ends).
 * A candidate WITH an event_date is judged by that date only; its window is ignored.
 */
export function candidateCoversDate(c: MatchCandidate, date: string): boolean {
  if (c.event_date) return c.event_date === date;
  if (!c.travel_depart || !c.travel_return) return false;
  return c.travel_depart <= date && date <= c.travel_return;
}

export const RULE_MATCH_MIN_SCORE = 0.8;

/**
 * Deterministic pick: the single candidate on our date (exact date, or a travel window
 * that contains it) whose title covers >= 80% of our name tokens. Two qualifying
 * candidates with the same score = ambiguous = null (the AI judge decides). A ±1-day
 * dated candidate is never picked by rule.
 */
export function pickRuleMatch(
  ours: { names: string[]; date: string },
  candidates: MatchCandidate[],
): { candidate: MatchCandidate; score: number } | null {
  const onDate = candidates.filter((c) => candidateCoversDate(c, ours.date));
  const scored = onDate
    .map((candidate) => ({ candidate, score: ruleMatchScore(ours, candidate) }))
    .filter((x) => x.score >= RULE_MATCH_MIN_SCORE)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 1) return scored[0];
  if (scored.length > 1 && scored[0].score > scored[1].score) return scored[0];
  return null;
}
```

(`RULE_MATCH_MIN_SCORE` keeps its current position/value — only move it if it now sits below its first use.)

- [ ] **Step 4: Run the selftest**

Run: `node scripts/price-light-selftest.ts`
Expected: `price-light selftest: all assertions passed`

- [ ] **Step 5: Candidate query — `lib/services/price-light-match.ts`**

Replace the body of `candidatesFor` so window listings are fetched too:

```ts
async function candidatesFor(event: LightEvent, competitor: CompetitorKey, scope: Scope): Promise<ListingRow[]> {
  const day = event.date.slice(0, 10);
  const from = shiftDay(day, -DATE_TOLERANCE_DAYS);
  const to = shiftDay(day, DATE_TOLERANCE_DAYS);
  // Two ways to be a candidate: a dated listing within ±DATE_TOLERANCE_DAYS, or (phase 2)
  // an undated listing whose travel window contains our date. PostgREST `or` with nested
  // `and` groups; every value is a YYYY-MM-DD string, no quoting needed.
  const { data, error } = await db.from("competitor_listings")
    .select("id,competitor,external_key,scope,title,title_he,event_date,city,venue,price_from,currency,price_usd,travel_depart,travel_return,attrs,detail_text,url,first_seen_at,last_seen_at,last_changed_at,run_id")
    .eq("competitor", competitor).eq("scope", scope)
    .or(`and(event_date.gte.${from},event_date.lte.${to}),and(event_date.is.null,travel_depart.lte.${day},travel_return.gte.${day})`)
    .gte("last_seen_at", new Date(Date.now() - STALE_LISTING_MS).toISOString());
  if (error) { console.error("price-light-match: candidates failed", JSON.stringify(error)); return []; }
  return (data ?? []) as ListingRow[];
}
```

And in `matchEvent`, the `pickRuleMatch` call maps the window through:

```ts
    candidates.map<MatchCandidate>((c) => ({
      id: c.id, title: c.title, title_he: c.title_he, event_date: c.event_date,
      travel_depart: c.travel_depart, travel_return: c.travel_return,
    })),
```

- [ ] **Step 6: Judge prompt — `lib/services/price-light-judge.ts`**

The candidate header line (currently `| date ${c.event_date ?? "?"} |`) must show the window when there is no date, so the judge can reason about it:

```ts
    const when = c.event_date ?? (c.travel_depart && c.travel_return ? `travel ${c.travel_depart}..${c.travel_return} (match date not published)` : "?");
    const head = `[${i}] ${c.title}${c.title_he && c.title_he !== c.title ? ` / ${c.title_he}` : ""} | date ${when} | city ${c.city ?? "?"} | price ${c.price_from ?? "?"} ${c.currency ?? ""}`;
```

- [ ] **Step 7: Crawl change detection — `lib/services/price-light-crawl.ts`**

A window move on an undated listing must bump `last_changed_at` (the matcher's only change trigger). Extend `listingChanged` and the `prev` select in `upsertListing`:

```ts
function listingChanged(
  prev: { price_from: number | null; event_date: string | null; travel_depart: string | null; travel_return: string | null; title: string; url: string; attrs: unknown } | null,
  next: Listing,
): boolean {
  if (!prev) return true;
  return Number(prev.price_from) !== Number(next.price_from) || prev.event_date !== next.event_date ||
    prev.travel_depart !== next.travel_depart || prev.travel_return !== next.travel_return ||
    prev.title !== next.title || prev.url !== next.url ||
    (next.attrs != null && JSON.stringify(prev.attrs ?? null) !== JSON.stringify(next.attrs));
}
```

and `.select("id,price_from,event_date,travel_depart,travel_return,title,url,attrs")` in `upsertListing`.

- [ ] **Step 8: Type + lint gate**

Run: `npx tsc --noEmit` and the eslint command from Global Constraints over the four modified `lib/` files + the selftest.
Expected: clean.

- [ ] **Step 9: Stop and report** (no commit).

---

### Task 2: Phase-2 migration + one-open-task guard

**Files:**
- Create: `supabase/migrations/20260911100000_price_light_phase2.sql`
- Modify: `lib/services/price-light-tasks.ts` (`openPriceLightTask` insert error path)

**Interfaces:**
- Consumes: `tasks.source_ref` (jsonb, `TaskSourceRef` in `types/task.types.ts`), `tasks.status` (`todo|in_progress|done|cancelled`), `tasks.deleted_at`. Verify each of those three columns exists in `db.schema.sql` or the tasks migration (`grep -n "source_ref\|deleted_at" supabase/migrations/*task*.sql db.schema.sql`) before writing the index.
- Produces: the migration file only (applied later, from master, by CI — never from here).

- [ ] **Step 1: Write the migration**

```sql
-- Price light (רמזור) phase 2.
-- 1) ISSTA/OnTour publish a travel window instead of a match date: the matcher looks up
--    undated listings by window (price-light-match.ts candidatesFor).
-- 2) One OPEN price-light task per event+scope: closes the TOCTOU gap two concurrent
--    "משימה" clicks could slip through (price-light-tasks.ts openPriceLightTask).
-- Idempotent; no CHECK constraints (repo rule).

create index if not exists cl_window_idx
  on public.competitor_listings (competitor, travel_depart, travel_return)
  where event_date is null;

create unique index if not exists tasks_price_light_open_uniq
  on public.tasks ((source_ref->>'row_id'), (source_ref->>'kind'))
  where source = 'price_light'
    and status in ('todo', 'in_progress')
    and deleted_at is null;
```

- [ ] **Step 2: Handle the unique violation in `openPriceLightTask`**

Replace the `if (error || !data)` block in `lib/services/price-light-tasks.ts`:

```ts
    if (error || !data) {
      // 23505 = the partial unique index tasks_price_light_open_uniq fired: another request
      // opened the same event+scope task between our dedupe read and this insert. Return it.
      if ((error as { code?: string } | null)?.code === "23505") {
        const raced = await openTaskFor(event.id, scope);
        if (raced) return { ok: true, taskId: raced.id, existed: true };
      }
      console.error(JSON.stringify(error));
      return { ok: false, error: "task insert failed" };
    }
```

- [ ] **Step 3: Guard checks**

Run: `ls supabase/migrations | grep 20260911100000` (exactly one file with that prefix) and `npx tsc --noEmit`.
Expected: one file; tsc clean. Do NOT run `npm run db:push`.

- [ ] **Step 4: Stop and report** (no commit).

---

### Task 3: Shared scraper helpers, `pauseShort`, per-site fixture harness

**Files:**
- Create: `lib/services/competitor-scrapers/shared.ts`
- Modify: `lib/services/competitor-scrapers/liveevents.ts` (import helpers from `shared.ts`, keep re-exports)
- Modify: `lib/services/competitor-scrapers/types.ts` (`pauseShort`)
- Modify: `lib/services/browser.ts` (`shortPause`)
- Modify: `lib/services/price-light-crawl.ts` (ctx builder), `scripts/scrape-once.ts` (ctx)
- Create: `scripts/fixture-checks/types.ts`, `scripts/fixture-checks/liveevents.ts`
- Modify: `scripts/scrape-fixture.ts` (generic loader)

**Interfaces:**
- Produces (`shared.ts`): `doc(html): Document`, `isoOrNull(y,m,d): string|null`, `parseHeDate(text): string|null`, `parsePrice(text): number|null`, `currencyFromSymbol(sym): Currency|null`, `stealthHeaders(): Record<string,string>`, `nightsBetween(depart, ret): number | "unknown"`, `flatText(el: Element | null, noise?: string): string`, `textLines(el: Element): string[]`, `absoluteUrl(href, base): string`.
- Produces (`browser.ts`): `PAUSE_SHORT_MIN_MS = 5_000`, `PAUSE_SHORT_MAX_MS = 15_000`, `shortPause(): Promise<void>`.
- Produces (`types.ts`): `CrawlContext.pauseShort: () => Promise<void>`.
- Produces (`scripts/fixture-checks/types.ts`): `FixtureFile { url: string; via: "fetch" | "browser"; waitFor?: string }`, `FixtureSpec { files: Record<string, FixtureFile>; check(read: (file: string) => string): void }`. Tasks 4–6 each add one `scripts/fixture-checks/<site>.ts` default-exporting a `FixtureSpec`.

- [ ] **Step 1: `shared.ts`**

```ts
// Helpers every competitor crawler shares. Pure, no "@/" imports, no DB - the fixture
// scripts import the parsers under plain `node --experimental-strip-types`.
import { parseHTML } from "linkedom";
import type { Currency } from "../../../types/price-light.types";
import { UAS } from "../browser.ts";

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
```

- [ ] **Step 2: `liveevents.ts` uses `shared.ts`**

Delete its local `ACCEPT_LANGUAGE`, `HE_MONTHS`, `pick`, `stealthHeaders`, `isoOrNull`, `parseHeDate`, `parsePrice`, `doc`, `currencyFromSymbol` definitions and the `UAS` import; add:

```ts
import { currencyFromSymbol, doc, parseHeDate, parsePrice, stealthHeaders } from "./shared.ts";
export { parseHeDate, parsePrice, stealthHeaders } from "./shared.ts";
```

Everything else in the file stays byte-identical (the fixture check for liveevents keeps passing — that is the test).

- [ ] **Step 3: `pauseShort`**

`lib/services/browser.ts`, next to `randomPause`:

```ts
export const PAUSE_SHORT_MIN_MS = 5_000;
export const PAUSE_SHORT_MAX_MS = 15_000;

/** Between paginated GETs of the SAME site in fetch mode (a person clicking league tabs) -
 *  the full 20-60s pause is for browser page loads and for switching sites. */
export async function shortPause(): Promise<void> {
  const ms = PAUSE_SHORT_MIN_MS + Math.floor(Math.random() * (PAUSE_SHORT_MAX_MS - PAUSE_SHORT_MIN_MS));
  await new Promise((r) => setTimeout(r, ms));
}
```

`types.ts` `CrawlContext`:

```ts
  /** Random 20-60s pause - between browser page loads and between sites. */
  pause: () => Promise<void>;
  /** Random 5-15s pause - only between paginated GETs of the same site in fetch mode. */
  pauseShort: () => Promise<void>;
```

`price-light-crawl.ts` ctx builder: import `shortPause` from `@/lib/services/browser` and add `pauseShort: scraper.mode === "table" ? async () => undefined : shortPause,`. `scripts/scrape-once.ts`: import `shortPause` and add `pauseShort: shortPause` to its ctx.

- [ ] **Step 4: Fixture harness**

`scripts/fixture-checks/types.ts`:

```ts
export interface FixtureFile {
  url: string;
  /** browser = needs a hydrated DOM (withBrowser); fetch = server-rendered, plain fetch + stealthHeaders. */
  via: "fetch" | "browser";
  /** browser only: selector to wait for before reading page.content(). */
  waitFor?: string;
}
export interface FixtureSpec {
  files: Record<string, FixtureFile>;
  /** Throws (node:assert) on regression. `read(file)` returns the saved HTML. */
  check(read: (file: string) => string): void;
}
```

`scripts/fixture-checks/liveevents.ts`: move the current `FIXTURE_URLS` (with `via`: `catalog.html` → `browser` + `waitFor: ".accord-crap div.line"`, the other three → `fetch`) and the whole `runAssertions` body (as `check(read)`, replacing each `readFileSync(\`${dir}/x\`, "utf8")` with `read("x")`) into a default-exported `FixtureSpec`. Imports stay `../../lib/services/competitor-scrapers/liveevents.ts`.

`scripts/scrape-fixture.ts` becomes the generic runner:

```ts
/**
 * Runs a crawler's pure parsers on saved HTML - regression without network.
 * Run: node --env-file=.env.local scripts/scrape-fixture.ts <liveevents|issta|ontour|golasso>
 * --save fetches that site's fixture pages once (the only network access this script makes,
 * one visit per page, 20s apart) into scripts/fixtures/<site>/.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { withBrowser } from "../lib/services/browser.ts";
import { stealthHeaders } from "../lib/services/competitor-scrapers/shared.ts";
import type { FixtureSpec } from "./fixture-checks/types.ts";

const SITES = ["liveevents", "issta", "ontour", "golasso"] as const;
const site = process.argv[2] as (typeof SITES)[number];
if (!SITES.includes(site)) {
  console.error(`usage: scrape-fixture.ts <${SITES.join("|")}> [--save]`);
  process.exit(2);
}
const save = process.argv.includes("--save");
const dir = `scripts/fixtures/${site}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchViaBrowser(url: string, waitFor?: string): Promise<string> {
  return withBrowser(async (page) => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    if (waitFor) await page.waitForSelector(waitFor, { timeout: 20_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    return page.content();
  });
}

async function fetchPlain(url: string): Promise<string> {
  const res = await fetch(url, { headers: stealthHeaders() });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

async function saveFixtures(spec: FixtureSpec): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const entries = Object.entries(spec.files);
  for (let i = 0; i < entries.length; i++) {
    const [file, f] = entries[i];
    console.error(`fetching ${f.url} (${f.via}) ...`);
    const html = f.via === "browser" ? await fetchViaBrowser(f.url, f.waitFor) : await fetchPlain(f.url);
    writeFileSync(`${dir}/${file}`, html, "utf8");
    console.error(`saved ${dir}/${file} (${html.length} bytes)`);
    if (i < entries.length - 1) { console.error("pausing 20s ..."); await sleep(20_000); }
  }
}

async function main(): Promise<void> {
  const spec = (await import(`./fixture-checks/${site}.ts`)).default as FixtureSpec;
  if (save) await saveFixtures(spec);
  else spec.check((file) => readFileSync(`${dir}/${file}`, "utf8"));
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 5: Verify nothing regressed**

Run: `node --env-file=.env.local scripts/scrape-fixture.ts liveevents`
Expected: `liveevents: N music listings, M sports listings parsed, detail ok` (same numbers as before the move).
Run: `npx tsc --noEmit` + eslint over every touched file.
Expected: clean.

- [ ] **Step 6: Stop and report** (no commit).

---

### Task 4: ISSTA Sport crawler (`issta`)

**Files:**
- Create: `lib/services/competitor-scrapers/issta.ts`
- Create: `scripts/fixture-checks/issta.ts`, `scripts/fixtures/issta/catalog.html` (via `--save`)

**Interfaces:**
- Consumes: `shared.ts` helpers (Task 3), `CompetitorScraper`/`CrawlContext`/`Listing` (`types.ts`), `UNKNOWN_ATTRS` (`types/price-light.types.ts`), `toUsd` (dynamic import of `./livetickets-api.ts`), `ctx.pauseShort` (Task 3).
- Produces: `export const issta: CompetitorScraper` (`key: "issta"`, `scopes: ["package"]`, `kinds: ["sports"]`, `intervalHours: 48`, `mode: "fetch"`, no `detail`), `export function parseCatalog(html: string, pageUrl: string): Listing[]`, `export const LEAGUE_URLS: string[]`.

Recon facts (verbatim source `phase2-recon.md` → "ISSTA Sport"): league pages `/sportcategory/soccer/<league>`; one listing = `div.deal-item-container[itemscope]`; link `a[itemprop=url]` href `/loader?url=/sport/details?sid=3&vid=15&pid=<id>&dport=BCN&fdate=23/10/2026`; title `[itemprop=name]`; description `[itemprop=description]`; outbound `.directions-from span` (`DD/MM`), return `.directions-to span` (`DD/MM`), year from `fdate` (return may cross new year); price `[itemprop=price][content]`, currency `[itemprop=priceCurrency][content]` (`"€ "`); **no event date on the card**; per person double room; package = flight + hotel + ticket.

- [ ] **Step 1: Write the crawler**

```ts
// ISSTA Sport package crawler. Selectors + URLs from docs/superpowers/scrapers/phase2-recon.md.
// Server-rendered league pages with schema.org/Product microdata - plain fetch, no browser.
// The card publishes the TRAVEL WINDOW only (no match date): event_date is null and the
// matcher pairs it by `travel_depart <= event.date <= travel_return` (price-light.ts
// candidateCoversDate). Detail pages are a JS loader -> skipped in v1 (attrs unknown except
// nights, which the window gives us).
import { UNKNOWN_ATTRS } from "../../../types/price-light.types";
import type { Currency } from "../../../types/price-light.types";
import { currencyFromSymbol, doc, isoOrNull, nightsBetween, parsePrice, stealthHeaders } from "./shared.ts";
import type { CompetitorScraper, CrawlContext, Listing } from "./types";

const BASE = "https://www.issta.co.il";
const LEAGUES = ["spanish-league", "premier-league", "italian", "german-league", "champions-league", "uefa-europa-league", "superclasico", "french-league"];
export const LEAGUE_URLS = LEAGUES.map((l) => `${BASE}/sportcategory/soccer/${l}`);

/** "23/10/2026" -> "2026-10-23" (the loader link's fdate; DD/MM/YYYY only). */
function parseFdate(text: string): string | null {
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? isoOrNull(Number(m[3]), Number(m[2]), Number(m[1])) : null;
}

/** "27/10" with the outbound year; rolls into the next year when the return month is earlier. */
function parseReturn(text: string, depart: string): string | null {
  const m = text.match(/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const departMonth = Number(depart.slice(5, 7));
  let year = Number(depart.slice(0, 4));
  if (Number(m[2]) < departMonth) year += 1;
  const iso = isoOrNull(year, Number(m[2]), Number(m[1]));
  return iso && iso >= depart ? iso : null;
}

function attr(el: Element | null, name: string): string {
  return el?.getAttribute(name)?.trim() ?? "";
}

/** One Listing per Product card. Cards without a pid or a usable window are dropped. */
export function parseCatalog(html: string, pageUrl: string): Listing[] {
  const d = doc(html);
  const out: Listing[] = [];
  for (const card of Array.from(d.querySelectorAll('div.deal-item-container[itemscope]'))) {
    const link = card.querySelector('a[itemprop="url"]');
    let href = attr(link, "href");
    try { href = decodeURIComponent(href); } catch { /* keep raw */ }
    const pid = href.match(/[?&]pid=(\d+)/)?.[1];
    if (!pid) continue;
    const dport = href.match(/[?&]dport=([A-Za-z]{3})/)?.[1]?.toUpperCase() ?? null;
    const depart = parseFdate(href.match(/[?&]fdate=([^&]+)/)?.[1] ?? "");
    if (!depart) continue;
    const ret = parseReturn(card.querySelector(".directions-to span")?.textContent ?? "", depart);
    if (!ret) continue;

    const nameEl = card.querySelector('[itemprop="name"]');
    const title = (nameEl?.textContent?.trim() || attr(nameEl, "content")).replace(/\s+/g, " ");
    if (!title) continue;
    const description = (card.querySelector('[itemprop="description"]')?.textContent ?? "").replace(/\s+/g, " ").trim();

    const priceEl = card.querySelector('[itemprop="price"]');
    const price_from = parsePrice(attr(priceEl, "content") || (priceEl?.textContent ?? ""));
    const currency: Currency | null = currencyFromSymbol(attr(card.querySelector('[itemprop="priceCurrency"]'), "content") || "€");

    out.push({
      competitor: "issta",
      external_key: `pid=${pid}`,
      scope: "package",
      title,
      title_he: title,
      event_date: null,
      city: dport,
      venue: null,
      price_from,
      currency: price_from == null ? null : currency,
      price_usd: null, // crawl() fills via toUsd (dynamic import - see the file banner)
      travel_depart: depart,
      travel_return: ret,
      attrs: { ...UNKNOWN_ATTRS, nights: nightsBetween(depart, ret) },
      detail_text: description ? `${title}. ${description}` : title,
      url: href.startsWith("http") ? href : `${BASE}${href.startsWith("/") ? "" : "/"}${href}`,
    });
  }
  void pageUrl;
  return out;
}

export const issta: CompetitorScraper = {
  key: "issta",
  scopes: ["package"],
  kinds: ["sports"],
  intervalHours: 48,
  mode: "fetch",
  async *crawl(ctx: CrawlContext): AsyncGenerator<Listing> {
    const { toUsd } = await import("./livetickets-api.ts");
    const seen = new Set<string>();
    for (let i = 0; i < LEAGUE_URLS.length; i++) {
      const url = LEAGUE_URLS[i];
      let html: string;
      try {
        const res = await ctx.fetch(url, { headers: stealthHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        html = await res.text();
      } catch (err) {
        ctx.log(`issta: ${url} -> ${(err as Error).message}`);
        await ctx.pauseShort();
        continue;
      }
      const listings = parseCatalog(html, url);
      ctx.log(`issta: ${url} -> ${listings.length} listings`);
      if (listings.length === 0) ctx.log(`issta: ZERO listings on ${url} - selectors may have changed`);
      for (const l of listings) {
        if (seen.has(l.external_key)) continue; // the same package sits on several league pages
        seen.add(l.external_key);
        yield {
          ...l,
          price_usd: l.price_from == null || l.currency == null ? null : Math.round(toUsd(l.price_from, l.currency)),
        };
      }
      if (i < LEAGUE_URLS.length - 1) await ctx.pauseShort();
    }
  },
};
```

- [ ] **Step 2: Fixture check**

`scripts/fixture-checks/issta.ts`:

```ts
import assert from "node:assert/strict";
import { LEAGUE_URLS, parseCatalog } from "../../lib/services/competitor-scrapers/issta.ts";
import type { FixtureSpec } from "./types.ts";

const spec: FixtureSpec = {
  files: {
    "catalog.html": { url: LEAGUE_URLS[0], via: "fetch" }, // spanish-league (~23 cards at recon time)
  },
  check(read) {
    const listings = parseCatalog(read("catalog.html"), LEAGUE_URLS[0]);
    assert.ok(listings.length >= 10, `expected >= 10 listings, got ${listings.length}`);
    const keys = new Set<string>();
    let priced = 0;
    for (const l of listings) {
      assert.match(l.external_key, /^pid=\d+$/, `key ${l.external_key}`);
      assert.ok(!keys.has(l.external_key), `duplicate ${l.external_key}`);
      keys.add(l.external_key);
      assert.ok(l.title, "title");
      assert.equal(l.event_date, null, "issta cards carry no match date");
      assert.match(l.travel_depart ?? "", /^\d{4}-\d{2}-\d{2}$/, `depart ${l.travel_depart}`);
      assert.match(l.travel_return ?? "", /^\d{4}-\d{2}-\d{2}$/, `return ${l.travel_return}`);
      assert.ok((l.travel_return ?? "") > (l.travel_depart ?? ""), `window order ${l.travel_depart}..${l.travel_return}`);
      assert.ok(typeof l.attrs?.nights === "number" && l.attrs.nights >= 1, `nights ${String(l.attrs?.nights)}`);
      assert.match(l.city ?? "", /^[A-Z]{3}$/, `city ${l.city}`);
      assert.match(l.url, /^https:\/\/www\.issta\.co\.il\//, `url ${l.url}`);
      if (l.price_from != null) { assert.equal(l.currency, "EUR"); assert.ok(l.price_from > 100, `price ${l.price_from}`); priced += 1; }
    }
    assert.ok(priced >= 5, `expected >= 5 priced listings, got ${priced}`);
    console.log(`issta: ${listings.length} listings parsed (${priced} priced)`);
    console.log("sample:", listings[0]);
  },
};
export default spec;
```

- [ ] **Step 3: Save the fixture (one GET) and run the check**

Run: `node --env-file=.env.local scripts/scrape-fixture.ts issta --save` then `node --env-file=.env.local scripts/scrape-fixture.ts issta`
Expected: the assertions pass. If a selector from the recon does not match the saved HTML, fix the parser against the fixture and append an "Addendum (2026-09-11, build)" paragraph to the ISSTA section of `docs/superpowers/scrapers/phase2-recon.md` naming the difference.

- [ ] **Step 4: Gate**

Run: `npx tsc --noEmit` + eslint over `issta.ts` and the check file. Expected: clean.

- [ ] **Step 5: Stop and report** (no commit; do NOT register in `index.ts` — Task 7 does).

---

### Task 5: OnTour crawler (`ontour`)

**Files:**
- Create: `lib/services/competitor-scrapers/ontour.ts`
- Create: `scripts/fixture-checks/ontour.ts`, `scripts/fixtures/ontour/{artists,performer}.html` (via `--save`)

**Interfaces:**
- Consumes: as Task 4.
- Produces: `export const ontour: CompetitorScraper` (`key: "ontour"`, `scopes: ["package"]`, `kinds: ["music"]`, `intervalHours: 48`, `mode: "fetch"`, no `detail` — the performer page already carries the flight/hotel/ticket blocks), `export function parseArtists(html: string, pageUrl: string): string[]` (performer URLs that currently sell), `export function parsePerformer(html: string, pageUrl: string): Listing[]`, `export function attrsFromText(flat: string): Partial<ExtractedAttrs>` (site-local markers; Golasso keeps its own).

Recon facts (`phase2-recon.md` → "OnTour"): `/artists/` = performer cards, only cards containing `חבילות זמינות` sell; performer page `/performer/<slug>/`, one `div.event-details` per package; `.flight-dates strong` ×2 = יציאה/חזרה `DD.MM.YYYY`; price `p.hide-mobile strong` (`€1,399`), some performers show no price → quote-only; `h2` = `Shakira | MADRID`; `.event-location small` = venue; expanded blocks `#flights<id>` / `#hotel<id>` / `#tickets<id>` with text like "טיסות ישירות עם אייר אירופה כולל תיק גב וטרולי עד 8 ק"ג", hotel stars/nights/breakfast ("ע"ב לינה וארוחת בוקר"), ticket section; concert date not explicit → derive from the ticket block if a date appears there, else null + window; `external_key = <slug>#<travel_depart>`.

- [ ] **Step 1: Write the crawler**

```ts
// OnTour (ISSTA's music arm, ontour.co.il) package crawler. Selectors from
// docs/superpowers/scrapers/phase2-recon.md. WordPress, server-rendered - plain fetch.
// Crawl = /artists/ (which performers currently sell) + one GET per selling performer.
// Everything (flights / hotel / tickets) sits on the performer page, so there is no detail().
// The card gives a TRAVEL WINDOW; the concert date is only taken when the ticket block
// prints one inside that window - otherwise event_date is null and the matcher uses the window.
import { UNKNOWN_ATTRS } from "../../../types/price-light.types";
import type { ExtractedAttrs } from "../../../types/price-light.types";
import { absoluteUrl, currencyFromSymbol, doc, flatText, nightsBetween, parseHeDate, parsePrice, stealthHeaders } from "./shared.ts";
import type { CompetitorScraper, CrawlContext, Listing } from "./types";

const BASE = "https://ontour.co.il";
export const ARTISTS_URL = `${BASE}/artists/`;
const SELLING_MARKER = "חבילות זמינות";
const MAX_PERFORMERS = 10; // recon: 3 selling at the time; 10 GETs + short pauses still fit the 240s budget

/** Performer URLs whose card on /artists/ says "חבילות זמינות" (walks up to 4 ancestors from the link). */
export function parseArtists(html: string, pageUrl: string): string[] {
  const d = doc(html);
  const urls: string[] = [];
  for (const a of Array.from(d.querySelectorAll('a[href*="/performer/"]'))) {
    const href = a.getAttribute("href") ?? "";
    if (!/\/performer\/[^/]+\/?$/.test(href)) continue;
    let el: Element | null = a;
    let sells = false;
    for (let i = 0; el && i < 5; i++) {
      if ((el.textContent ?? "").includes(SELLING_MARKER)) { sells = true; break; }
      el = el.parentElement;
    }
    if (!sells) continue;
    const url = absoluteUrl(href.endsWith("/") ? href : `${href}/`, pageUrl);
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

/** Hebrew markers on the performer page's flight / hotel / ticket blocks. */
export function attrsFromText(flat: string): Partial<ExtractedAttrs> {
  const a: Partial<ExtractedAttrs> = { ...UNKNOWN_ATTRS };
  if (/קונקשן|עצירת\s*ביניים|חניית\s*ביניים|טיסת\s*המשך/.test(flat)) a.direct_flight = false;
  else if (/טיסות?\s*ישיר/.test(flat)) a.direct_flight = true;
  if (/מזוודה|כבודה\s*רשומה|כבודת\s*בטן/.test(flat)) a.bag_included = true;
  else if (/תיק\s*גב|טרולי|כבודת\s*יד/.test(flat)) a.bag_included = false;
  const stars = flat.match(/(\d)\s*כוכבים/);
  if (stars) a.hotel_stars = Number(stars[1]);
  if (/לינה\s*בלבד|ללא\s*ארוחת\s*בוקר/.test(flat)) a.breakfast = false;
  else if (/ארוחת\s*בוקר/.test(flat)) a.breakfast = true;
  if (/ללא\s*העברות|לא\s*כולל\s*העברות|העברות\s*אינן\s*כלולות/.test(flat)) a.transfers = false;
  else if (/העברות/.test(flat)) a.transfers = true;
  return a;
}

/** The expanded blocks belong to the card: descendants with ids flights*/hotel*/tickets*, plus
 *  following siblings with such ids up to the next .event-details (both layouts seen in WP themes). */
function blockText(card: Element, prefix: "flights" | "hotel" | "tickets"): string {
  const parts: string[] = [];
  card.querySelectorAll(`[id^="${prefix}"]`).forEach((el) => parts.push(flatText(el)));
  let sib = card.nextElementSibling;
  while (sib && !sib.classList.contains("event-details")) {
    if (new RegExp(`^${prefix}\\d*$`).test(sib.id ?? "")) parts.push(flatText(sib));
    sib.querySelectorAll(`[id^="${prefix}"]`).forEach((el) => parts.push(flatText(el)));
    sib = sib.nextElementSibling;
  }
  return parts.join(" ");
}

export function parsePerformer(html: string, pageUrl: string): Listing[] {
  const d = doc(html);
  const slug = pageUrl.match(/\/performer\/([^/]+)\/?/)?.[1] ?? "unknown";
  const out: Listing[] = [];
  for (const card of Array.from(d.querySelectorAll("div.event-details"))) {
    const heading = (card.querySelector("h2")?.textContent ?? "").replace(/\s+/g, " ").trim();
    const [rawTitle, rawCity] = heading.split("|").map((s) => s.trim());
    const title = rawTitle || heading;
    if (!title) continue;
    const dates = Array.from(card.querySelectorAll(".flight-dates strong")).map((el) => parseHeDate(el.textContent ?? ""));
    const depart = dates[0] ?? null;
    const ret = dates[1] ?? null;
    if (!depart || !ret || ret <= depart) continue;

    const priceText = card.querySelector("p.hide-mobile strong")?.textContent ?? "";
    const price_from = parsePrice(priceText);
    const currency = price_from == null ? null : (currencyFromSymbol(priceText) ?? "EUR");

    const flights = blockText(card, "flights");
    const hotel = blockText(card, "hotel");
    const tickets = blockText(card, "tickets");
    const cardText = flatText(card);
    const flat = `${cardText} ${flights} ${hotel} ${tickets}`.replace(/\s+/g, " ").trim();

    // Concert date: only a date printed in the ticket block, and only if it sits inside the window.
    let event_date: string | null = null;
    for (const m of tickets.matchAll(/\d{1,2}[./]\d{1,2}[./]\d{2,4}/g)) {
      const iso = parseHeDate(m[0]);
      if (iso && iso >= depart && iso <= ret) { event_date = iso; break; }
    }

    out.push({
      competitor: "ontour",
      external_key: `${slug}#${depart}`,
      scope: "package",
      title,
      title_he: null,
      event_date,
      city: rawCity || null,
      venue: card.querySelector(".event-location small")?.textContent?.replace(/\s+/g, " ").trim() || null,
      price_from,
      currency,
      price_usd: null, // crawl() fills via toUsd
      travel_depart: depart,
      travel_return: ret,
      attrs: { ...attrsFromText(flat), nights: nightsBetween(depart, ret) },
      detail_text: flat.slice(0, 2000),
      url: pageUrl,
    });
  }
  return out;
}

export const ontour: CompetitorScraper = {
  key: "ontour",
  scopes: ["package"],
  kinds: ["music"],
  intervalHours: 48,
  mode: "fetch",
  async *crawl(ctx: CrawlContext): AsyncGenerator<Listing> {
    const { toUsd } = await import("./livetickets-api.ts");
    let performers: string[];
    try {
      const res = await ctx.fetch(ARTISTS_URL, { headers: stealthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      performers = parseArtists(await res.text(), ARTISTS_URL);
    } catch (err) {
      throw new Error(`ontour: ${ARTISTS_URL} -> ${(err as Error).message}`); // no index page = failed run
    }
    ctx.log(`ontour: ${performers.length} selling performers`);
    if (performers.length === 0) ctx.log("ontour: ZERO selling performers - marker or selectors may have changed");
    const seen = new Set<string>();
    for (const url of performers.slice(0, MAX_PERFORMERS)) {
      await ctx.pauseShort();
      let html: string;
      try {
        const res = await ctx.fetch(url, { headers: stealthHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        html = await res.text();
      } catch (err) {
        ctx.log(`ontour: ${url} -> ${(err as Error).message}`);
        continue;
      }
      const listings = parsePerformer(html, url);
      ctx.log(`ontour: ${url} -> ${listings.length} listings`);
      for (const l of listings) {
        if (seen.has(l.external_key)) continue;
        seen.add(l.external_key);
        yield {
          ...l,
          price_usd: l.price_from == null || l.currency == null ? null : Math.round(toUsd(l.price_from, l.currency)),
        };
      }
    }
  },
};
```

- [ ] **Step 2: Fixture check**

`scripts/fixture-checks/ontour.ts`:

```ts
import assert from "node:assert/strict";
import { ARTISTS_URL, attrsFromText, parseArtists, parsePerformer } from "../../lib/services/competitor-scrapers/ontour.ts";
import type { FixtureSpec } from "./types.ts";

// A performer that sold packages at recon time (2026-09-10: Shakira, Celine Dion, André Rieu).
// If --save 404s here, take the first URL parseArtists() returns from the freshly saved
// artists.html and update this constant.
const PERFORMER_URL = "https://ontour.co.il/performer/shakira/";

const spec: FixtureSpec = {
  files: {
    "artists.html": { url: ARTISTS_URL, via: "fetch" },
    "performer.html": { url: PERFORMER_URL, via: "fetch" },
  },
  check(read) {
    const performers = parseArtists(read("artists.html"), ARTISTS_URL);
    assert.ok(performers.length >= 1, "at least one selling performer");
    for (const u of performers) assert.match(u, /^https:\/\/ontour\.co\.il\/performer\/[^/]+\/$/, u);
    assert.ok(new Set(performers).size === performers.length, "performer urls unique");

    const listings = parsePerformer(read("performer.html"), PERFORMER_URL);
    assert.ok(listings.length >= 1, `expected >= 1 listing, got ${listings.length}`);
    const keys = new Set<string>();
    for (const l of listings) {
      assert.match(l.external_key, /^[^#]+#\d{4}-\d{2}-\d{2}$/, l.external_key);
      assert.ok(!keys.has(l.external_key), `duplicate ${l.external_key}`);
      keys.add(l.external_key);
      assert.ok(l.title, "title");
      assert.match(l.travel_depart ?? "", /^\d{4}-\d{2}-\d{2}$/);
      assert.match(l.travel_return ?? "", /^\d{4}-\d{2}-\d{2}$/);
      if (l.event_date) assert.ok(l.event_date >= (l.travel_depart ?? "") && l.event_date <= (l.travel_return ?? ""), "event_date inside window");
      assert.ok(typeof l.attrs?.nights === "number", "nights from the window");
      assert.ok((l.detail_text ?? "").length > 100, "detail_text");
      if (l.price_from != null) assert.equal(l.currency, "EUR");
    }
    const priced = listings.filter((l) => l.price_from != null);
    assert.ok(priced.length >= 1 || listings.every((l) => l.price_from == null), "priced or consistently quote-only");

    // marker unit checks (independent of the live page)
    assert.deepEqual(attrsFromText("טיסות ישירות עם אייר אירופה כולל תיק גב וטרולי עד 8 ק\"ג. מלון 4 כוכבים ע\"ב לינה וארוחת בוקר"),
      { bag_included: false, direct_flight: true, hotel_stars: 4, nights: "unknown", breakfast: true, transfers: "unknown" });
    assert.equal(attrsFromText("לינה בלבד").breakfast, false);
    assert.equal(attrsFromText("כולל מזוודה 23 ק\"ג").bag_included, true);
    console.log(`ontour: ${performers.length} performers, ${listings.length} listings (${priced.length} priced)`);
    console.log("sample:", listings[0]);
  },
};
export default spec;
```

- [ ] **Step 3: Save fixtures (two GETs, 20 s apart) and run the check**

Run: `node --env-file=.env.local scripts/scrape-fixture.ts ontour --save` then `node --env-file=.env.local scripts/scrape-fixture.ts ontour`
Expected: pass. Fix parser vs fixture + recon addendum if the markup differs (e.g. the expanded blocks live elsewhere — adjust `blockText`, keep the `attrsFromText` unit checks green).

- [ ] **Step 4: Gate** — `npx tsc --noEmit` + eslint over both files. Expected: clean.

- [ ] **Step 5: Stop and report** (no commit; no `index.ts` registration).

---

### Task 6: Golasso crawler (`golasso`, site goalzo.co.il)

**Files:**
- Create: `lib/services/competitor-scrapers/golasso.ts`
- Create: `scripts/fixture-checks/golasso.ts`, `scripts/fixtures/golasso/{catalog,detail}.html` (via `--save`; catalog through the browser)

**Interfaces:**
- Consumes: as Task 4 plus `ctx.page` (Playwright) for the catalog, `ctx.pause()` (full pause — it is a browser session).
- Produces: `export const golasso: CompetitorScraper` (`key: "golasso"`, `scopes: ["package"]`, `kinds: ["sports"]`, `intervalHours: 48`, `mode: "browser"`, WITH `detail()` — fetch of `/pdetails/<id>`), `export function parseCatalog(html: string, pageUrl: string): Listing[]`, `export function parseDetail(html: string, listing: Pick<Listing, "event_date" | "travel_depart">): Partial<Listing>`, `export const ALL_PACKAGES_URL: string`.

Recon facts (`phase2-recon.md` → "Golasso"): all-packages page `https://www.goalzo.co.il/כל_החבילות.html` (Next.js, list hydrates client-side → browser; wait for `a[href*="/pdetails/"]` ≥ 6); card text: title `רומא vs ריאל מדריד`, date `14.10.26, 21:00` (DD.MM.YY, time), city, price `€789`, href `/pdetails/<id>`; multi-show tours carry a range `25.09.26-01.10.26`; detail `/pdetails/<id>` server-rendered + fetchable: "€789" per person, "סה"כ ל-2 נוסעים", flight "Wizz Air", "טיסות ישירות", `12.10 10:55–13:45`, return `15.10`, "כוללת תיק גב בלבד", hotel "4 כוכבים"/`4★`, "ארבעה לילות", "לינה בלבד", ticket "קטגוריה 4". Ignore Israeli-team pages.

- [ ] **Step 1: Write the crawler**

```ts
// Golasso (goalzo.co.il) package crawler. Selectors + markers from
// docs/superpowers/scrapers/phase2-recon.md. The all-packages list hydrates client-side, so the
// catalog needs the Playwright page (mode "browser"); the /pdetails/<id> pages are
// server-rendered and go through ctx.fetch. Card text is regex-parsed (Next.js class names
// are hashed and unstable): title = the line with "vs"/"נגד", date = DD.MM.YY[, HH:MM] or a
// DD.MM.YY-DD.MM.YY range (tour -> null event_date + window), price = €N.
import { UNKNOWN_ATTRS } from "../../../types/price-light.types";
import type { ExtractedAttrs } from "../../../types/price-light.types";
import { doc, flatText, isoOrNull, nightsBetween, parseHeDate, parsePrice, stealthHeaders, textLines } from "./shared.ts";
import type { CompetitorScraper, CrawlContext, Listing } from "./types";

const BASE = "https://www.goalzo.co.il";
export const ALL_PACKAGES_URL = `${BASE}/${encodeURIComponent("כל_החבילות")}.html`;
const CARD_SELECTOR = 'a[href*="/pdetails/"]';
const MIN_CARDS = 6;

const DATE_RE = /(\d{2})\.(\d{2})\.(\d{2})/;
const RANGE_RE = /(\d{2}\.\d{2}\.\d{2})\s*[-–]\s*(\d{2}\.\d{2}\.\d{2})/;
const PRICE_RE = /€\s?([\d,]{3,6})/;
const TITLE_RE = /\s(vs|נגד|מול)\s|\s-\s/i;

/** The card element = the anchor itself when it holds a € price, else its nearest ancestor (≤ 5 up) that does. */
function cardOf(a: Element): Element | null {
  let el: Element | null = a;
  for (let i = 0; el && i < 6; i++) {
    if (PRICE_RE.test(el.textContent ?? "")) return el;
    el = el.parentElement;
  }
  return null;
}

export function parseCatalog(html: string, pageUrl: string): Listing[] {
  const d = doc(html);
  const out: Listing[] = [];
  const seen = new Set<string>();
  for (const a of Array.from(d.querySelectorAll(CARD_SELECTOR))) {
    const id = (a.getAttribute("href") ?? "").match(/\/pdetails\/(\d+)/)?.[1];
    if (!id || seen.has(id)) continue;
    const card = cardOf(a);
    if (!card) continue;
    const lines = textLines(card);
    const title = lines.find((l) => TITLE_RE.test(l) && !DATE_RE.test(l) && !PRICE_RE.test(l))?.replace(/\s+/g, " ") ?? null;
    if (!title) continue;
    const range = lines.map((l) => l.match(RANGE_RE)).find(Boolean);
    const single = lines.map((l) => l.match(DATE_RE)).find(Boolean);
    let event_date: string | null = null;
    let travel_depart: string | null = null;
    let travel_return: string | null = null;
    if (range) {
      travel_depart = parseHeDate(range[1]);
      travel_return = parseHeDate(range[2]);
      if (!travel_depart || !travel_return || travel_return <= travel_depart) continue;
    } else if (single) {
      event_date = isoOrNull(2000 + Number(single[3]), Number(single[2]), Number(single[1]));
      if (!event_date) continue;
    } else continue;
    const priceLine = lines.find((l) => PRICE_RE.test(l));
    const price_from = priceLine ? parsePrice(priceLine.match(PRICE_RE)?.[1] ?? "") : null;
    const city = lines.find((l) => l !== title && !/\d/.test(l) && l.length <= 30 && !/vs|נגד|מול/i.test(l)) ?? null;
    seen.add(id);
    out.push({
      competitor: "golasso",
      external_key: id,
      scope: "package",
      title,
      title_he: title,
      event_date,
      city,
      venue: null,
      price_from,
      currency: price_from == null ? null : "EUR",
      price_usd: null, // crawl() fills via toUsd
      travel_depart,
      travel_return,
      attrs: null,      // detail() fills for matched / on-date listings
      detail_text: null,
      url: `${BASE}/pdetails/${id}`,
    });
  }
  void pageUrl;
  return out;
}

const HE_NUMBER: Record<string, number> = { "לילה אחד": 1, "שני לילות": 2, "שלושה לילות": 3, "ארבעה לילות": 4, "חמישה לילות": 5, "שישה לילות": 6, "שבעה לילות": 7 };

function nightsFromText(flat: string): number | "unknown" {
  const n = flat.match(/(\d{1,2})\s*לילות/);
  if (n) return Number(n[1]);
  for (const [words, value] of Object.entries(HE_NUMBER)) if (flat.includes(words)) return value;
  return "unknown";
}

/** "12.10 10:55" ... "15.10" - flight lines print DD.MM without a year; anchor on the listing's date. */
function windowFromText(flat: string, anchor: string | null): { depart: string | null; ret: string | null } {
  const days = Array.from(flat.matchAll(/(\d{2})\.(\d{2})(?!\.\d)\s+\d{2}:\d{2}/g));
  if (days.length < 2 || !anchor) return { depart: null, ret: null };
  const year = Number(anchor.slice(0, 4));
  const toIso = (m: RegExpMatchArray, adjust: -1 | 0 | 1) => isoOrNull(year + adjust, Number(m[2]), Number(m[1]));
  let depart = toIso(days[0], 0);
  let ret = toIso(days[days.length - 1], 0);
  if (depart && depart > anchor) depart = toIso(days[0], -1);
  if (ret && ret < anchor) ret = toIso(days[days.length - 1], 1);
  return depart && ret && ret > depart ? { depart, ret } : { depart: null, ret: null };
}

export function parseDetail(html: string, listing: Pick<Listing, "event_date" | "travel_depart">): Partial<Listing> {
  const d = doc(html);
  const flat = flatText(d.querySelector("main") ?? d.body);
  if (!PRICE_RE.test(flat)) return {};
  const anchor = listing.event_date ?? listing.travel_depart;
  const win = windowFromText(flat, anchor);
  const starsMatch = flat.match(/(\d)\s*(כוכבים|★)/);
  const nightsText = nightsFromText(flat);
  const attrs: Partial<ExtractedAttrs> = {
    ...UNKNOWN_ATTRS,
    bag_included: /תיק\s*גב\s*בלבד|כבודת\s*יד\s*בלבד/.test(flat) ? false : /מזוודה|כבודה\s*רשומה/.test(flat) ? true : "unknown",
    direct_flight: /קונקשן|עצירת\s*ביניים|חניית\s*ביניים/.test(flat) ? false : /טיסות?\s*ישיר/.test(flat) ? true : "unknown",
    hotel_stars: starsMatch ? Number(starsMatch[1]) : "unknown",
    nights: nightsText !== "unknown" ? nightsText : nightsBetween(win.depart, win.ret),
    breakfast: /לינה\s*בלבד|ללא\s*ארוחת\s*בוקר/.test(flat) ? false : /ארוחת\s*בוקר/.test(flat) ? true : "unknown",
    transfers: /ללא\s*העברות|לא\s*כולל\s*העברות/.test(flat) ? false : /העברות/.test(flat) ? true : "unknown",
  };
  const partial: Partial<Listing> = { attrs, detail_text: flat.slice(0, 2000) };
  if (win.depart && win.ret) { partial.travel_depart = win.depart; partial.travel_return = win.ret; }
  const price = parsePrice(flat.match(PRICE_RE)?.[1] ?? "");
  if (price != null) { partial.price_from = price; partial.currency = "EUR"; }
  return partial;
}

async function loadCatalog(ctx: CrawlContext): Promise<string> {
  const page = ctx.page;
  if (!page) throw new Error("golasso: catalog needs a browser page");
  await page.goto(ALL_PACKAGES_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(CARD_SELECTOR, { timeout: 30_000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  // Lazy lists render on scroll - nudge to the bottom a few times, then settle.
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 4000).catch(() => undefined);
    await page.waitForTimeout(800);
  }
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  return page.content();
}

export const golasso: CompetitorScraper = {
  key: "golasso",
  scopes: ["package"],
  kinds: ["sports"],
  intervalHours: 48,
  mode: "browser",
  async *crawl(ctx: CrawlContext): AsyncGenerator<Listing> {
    const { toUsd } = await import("./livetickets-api.ts");
    const html = await loadCatalog(ctx); // a failed load = failed run (one page IS the crawl)
    const listings = parseCatalog(html, ALL_PACKAGES_URL);
    ctx.log(`golasso: ${ALL_PACKAGES_URL} -> ${listings.length} listings`);
    if (listings.length < MIN_CARDS) ctx.log(`golasso: only ${listings.length} cards (< ${MIN_CARDS}) - hydration wait or selectors may have changed`);
    for (const l of listings) {
      yield { ...l, price_usd: l.price_from == null ? null : Math.round(toUsd(l.price_from, "EUR")) };
    }
    await ctx.pause();
  },
  async detail(listing: Listing, ctx: CrawlContext): Promise<Partial<Listing>> {
    if (listing.scope !== "package" || !/\/pdetails\/\d+/.test(listing.url)) return {};
    try {
      const res = await ctx.fetch(listing.url, { headers: stealthHeaders() });
      if (!res.ok) { ctx.log(`golasso: detail ${listing.url} -> HTTP ${res.status}`); return {}; }
      const partial = parseDetail(await res.text(), listing);
      if (partial.price_from != null) {
        const { toUsd } = await import("./livetickets-api.ts");
        partial.price_usd = Math.round(toUsd(partial.price_from, "EUR"));
      }
      return partial;
    } catch (err) {
      ctx.log(`golasso: detail ${listing.url} -> ${(err as Error).message}`);
      return {};
    }
  },
};
```

- [ ] **Step 2: Fixture check**

`scripts/fixture-checks/golasso.ts`:

```ts
import assert from "node:assert/strict";
import { ALL_PACKAGES_URL, parseCatalog, parseDetail } from "../../lib/services/competitor-scrapers/golasso.ts";
import type { FixtureSpec } from "./types.ts";

// Recon detail page (Roma vs Real Madrid, 2026-10-14). If it 404s at --save time, take the
// first `url` parseCatalog() returns from the freshly saved catalog.html and update this.
const DETAIL_URL = "https://www.goalzo.co.il/pdetails/20627";

const spec: FixtureSpec = {
  files: {
    "catalog.html": { url: ALL_PACKAGES_URL, via: "browser", waitFor: 'a[href*="/pdetails/"]' },
    "detail.html": { url: DETAIL_URL, via: "fetch" },
  },
  check(read) {
    const listings = parseCatalog(read("catalog.html"), ALL_PACKAGES_URL);
    assert.ok(listings.length >= 6, `expected >= 6 listings, got ${listings.length}`);
    const keys = new Set<string>();
    for (const l of listings) {
      assert.match(l.external_key, /^\d+$/, l.external_key);
      assert.ok(!keys.has(l.external_key), `duplicate ${l.external_key}`);
      keys.add(l.external_key);
      assert.ok(l.title, "title");
      if (l.event_date) assert.match(l.event_date, /^\d{4}-\d{2}-\d{2}$/, `date ${l.event_date}`);
      else { assert.match(l.travel_depart ?? "", /^\d{4}-\d{2}-\d{2}$/, "tour window depart"); assert.match(l.travel_return ?? "", /^\d{4}-\d{2}-\d{2}$/, "tour window return"); }
      assert.match(l.url, /^https:\/\/www\.goalzo\.co\.il\/pdetails\/\d+$/, l.url);
      if (l.price_from != null) { assert.equal(l.currency, "EUR"); assert.ok(l.price_from >= 100, `price ${l.price_from}`); }
    }
    const dated = listings.filter((l) => l.event_date);
    assert.ok(dated.length >= listings.length / 2, "most cards carry a match date");
    assert.ok(listings.filter((l) => l.price_from != null).length >= 5, "priced cards");

    const first = listings[0];
    const detail = parseDetail(read("detail.html"), { event_date: "2026-10-14", travel_depart: null });
    assert.ok(detail.attrs, "detail attrs");
    assert.ok(typeof detail.attrs?.hotel_stars === "number", `stars ${String(detail.attrs?.hotel_stars)}`);
    assert.ok(typeof detail.attrs?.nights === "number", `nights ${String(detail.attrs?.nights)}`);
    assert.notEqual(detail.attrs?.bag_included, "unknown", "bag marker");
    assert.notEqual(detail.attrs?.breakfast, "unknown", "breakfast marker");
    assert.ok((detail.price_from ?? 0) >= 100, `detail price ${detail.price_from}`);
    assert.ok((detail.detail_text ?? "").length > 200, "detail_text");
    assert.deepEqual(parseDetail("<html><body>nothing here</body></html>", first), {}, "no-price page -> {}");
    console.log(`golasso: ${listings.length} listings (${dated.length} dated), detail ok`);
    console.log("sample:", first);
    console.log("detail:", detail);
  },
};
export default spec;
```

- [ ] **Step 3: Save fixtures and run the check**

Run: `node --env-file=.env.local scripts/scrape-fixture.ts golasso --save` (catalog via `withBrowser` — local `@sparticuz/chromium`, or `LOCAL_CHROME_PATH` if set in `.env.local`) then `node --env-file=.env.local scripts/scrape-fixture.ts golasso`
Expected: pass. The card regexes are the part most likely to need adjusting against the real DOM — adjust `TITLE_RE`/`cardOf`/city pick against the fixture, keep the assertions, and append the addendum to the recon doc with what the card actually looks like (three text lines of one card, verbatim).

- [ ] **Step 4: Gate** — `npx tsc --noEmit` + eslint. Expected: clean.

- [ ] **Step 5: Stop and report** (no commit; no `index.ts` registration).

---

### Task 7: Registration, display names, docs

**Files:**
- Modify: `lib/services/competitor-scrapers/index.ts`
- Modify: `app/(dashboard)/events/price-light-ui.tsx` (+ `COMPETITOR_LABEL`), `app/(dashboard)/price-light/competitors-panel.tsx` (card title), the tooltip line in `price-light-ui.tsx` that prints `detail.competitor`
- Modify: `CLAUDE.md` (Price light section: phase-2 paragraph), `app/(dashboard)/guide/guide-content.ts` (price-light section: one EN+HE paragraph on the four sites and window matching), `docs/superpowers/scrapers/phase2-recon.md` (status line at the top: "implemented 2026-09-11 — see addenda"), `docs/superpowers/specs/2026-09-09-price-light-design.md` §3.1 (`phase 2` → `phase 2 ✅`)

**Interfaces:**
- Consumes: `issta`, `ontour`, `golasso` scrapers (Tasks 4–6), `CompetitorKey`.
- Produces: `ACTIVE_COMPETITORS` = `["liveevents","issta","golasso","ontour","livetickets"]`; `export const COMPETITOR_LABEL: Record<CompetitorKey, string>`.

- [ ] **Step 1: Register**

`index.ts`:

```ts
import { liveevents } from "./liveevents";
import { issta } from "./issta";
import { golasso } from "./golasso";
import { ontour } from "./ontour";
import { livetickets } from "./livetickets-api";

// Registration order = the order the crawl panel lists them. A competitor NOT in this map
// never counts toward "alone". livetickets stays last (table mode, refreshed by the nightly).
export const SCRAPERS: Partial<Record<CompetitorKey, CompetitorScraper>> = {};
SCRAPERS.liveevents = liveevents;
SCRAPERS.issta = issta;
SCRAPERS.golasso = golasso;
SCRAPERS.ontour = ontour;
SCRAPERS.livetickets = livetickets;
```

(`ACTIVE_COMPETITORS` line stays LAST.)

- [ ] **Step 2: Display names**

`price-light-ui.tsx`:

```ts
export const COMPETITOR_LABEL: Record<CompetitorKey, string> = {
  liveevents: "LiveEvents", issta: "ISSTA Sport", golasso: "Golasso", ontour: "OnTour", livetickets: "LiveTickets",
};
```

Use it in the tooltip line (`${COMPETITOR_LABEL[detail.competitor] ?? detail.competitor}: raw …`) and in `competitors-panel.tsx` `CardTitle` (drop `capitalize`). `price-light-tasks.ts` descriptions keep the raw keys (they are audit text, not UI).

- [ ] **Step 3: Docs**

`CLAUDE.md`, append to the Price light section:

> **Phase 2 (2026-09-11): ISSTA Sport, Golasso, OnTour.** Three more crawlers in `lib/services/competitor-scrapers/` (`issta.ts` fetch-mode, 8 league pages; `golasso.ts` browser-mode all-packages page + fetchable `/pdetails/<id>` detail; `ontour.ts` fetch-mode `/artists/` → selling performer pages), registered in `index.ts` so the sports package light now compares against LiveEvents + ISSTA + Golasso and the music package light against LiveEvents + OnTour — "alone" needs all of them fresh. **ISSTA and OnTour publish a travel window, not the match date:** such listings store `event_date = null` + `travel_depart/return`, and the matcher (`candidateCoversDate` in `price-light.ts`, the OR-clause in `candidatesFor`) treats them as on-date when the window contains our date. Shared parser helpers live in `competitor-scrapers/shared.ts`; `ctx.pauseShort()` (5–15 s) is the only pacing allowed between same-site paginated GETs in fetch mode. Fixture regression is per site: `scripts/scrape-fixture.ts <site>` with assertions in `scripts/fixture-checks/<site>.ts`. Recon + build addenda: `docs/superpowers/scrapers/phase2-recon.md`. **The light never touches pricing** — it reads `ourPackageUsd`/`ourTicketUsd` and writes only `light_*` columns; the pricing brain (`price-quote.ts`, `base-price-sync`, `/price-changes`) is untouched and stays the source of truth.

`guide-content.ts`, price-light section, one paragraph pair (EN then HE) after the crawling/kill-switch item:

> EN: "Competitors, phase 2: sports packages are compared against LiveEvents, ISSTA Sport and Golasso; music packages against LiveEvents and OnTour; tickets against LiveTickets. ISSTA and OnTour publish the trip dates rather than the match date, so the light pairs those by the travel window that contains the event — the tooltip shows which site set the light and what its trip dates were."
> HE: "מתחרים, שלב 2: חבילות ספורט מושוות מול LiveEvents, איסתא ספורט וגולאסו; חבילות מוזיקה מול LiveEvents ואון.טור; כרטיסים מול LiveTickets. איסתא ואון.טור מפרסמים את תאריכי הנסיעה ולא את תאריך המשחק, ולכן הרמזור מצמיד אותם לפי חלון הנסיעה שמכיל את האירוע — הטולטיפ מראה איזה אתר קבע את האור ומה היו תאריכי הנסיעה שלו."

- [ ] **Step 4: Gate**

Run: `npx tsc --noEmit`; eslint over `index.ts`, `price-light-ui.tsx`, `competitors-panel.tsx`, `guide-content.ts`; `node scripts/price-light-selftest.ts`; `node --env-file=.env.local scripts/scrape-fixture.ts liveevents` (and `issta`, `ontour`, `golasso`); `npm run build`.
Expected: all clean, build exit 0.

- [ ] **Step 5: Stop and report** (no commit).

---

## Self-review

- **Spec coverage:** §2.3 competitors per kind (Task 7 registration), §3 scraper interface (Tasks 4–6, `pauseShort` is an additive extension of `CrawlContext`), §4 matching (Task 1 window rule), §12 row 2 (all). Recon cross-cutting decisions 1–5: 1 → Task 1; 2 → Tasks 4–6 (Golasso detail only for matched/on-date listings via the existing `listingIdsWorthDetail`; tour-range Golasso listings have no date and get no detail — accepted, rare); 3 → Task 7; 4 → fixture checks; 5 → one browser session per Golasso crawl.
- **Placeholders:** none — every parser carries its code; the only "adjust against the fixture" instructions concern regexes whose truth lives in the live DOM and are gated by explicit assertions.
- **Type consistency:** `candidateCoversDate(c: MatchCandidate, date: string)` (Task 1) used by selftest; `MatchCandidate.travel_*` optional so phase-0 callers compile; `FixtureSpec.check(read)` shape identical across Tasks 3–6; `CrawlContext.pauseShort` set in both ctx builders (Task 3) before Tasks 4–5 call it; `Listing.attrs: null` legal (type `Partial<ExtractedAttrs> | null`).
- **Not in this plan (deferred, unchanged from phase 1):** `dueBasisFor` helper, `/tasks` `price_light` badge, unit tests for override-drift / truncation / budget, `npm run db:types` + dropping `as any` after merge.
