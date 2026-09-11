# Price Light (רמזור) — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff can act on red lights: an AI judge resolves ambiguous matches and extracts package attributes, a `/price-light` screen lists every light with four actions (הוזל / השאר בפיד / הסר / משימה), tasks open and auto-close, and the dashboard shows the light distribution.

**Architecture:** `lib/services/price-light-judge.ts` wraps the Anthropic SDK behind the existing `Judge` hook of `price-light-match.ts` (one call per (event, listing) pair, cached through `competitor_matches.ai_verdict`). Server actions in `lib/actions/price-light-actions.ts` gain the four decisions + listing queries; `/price-light` is a `data-table.tsx` v2 screen in the pattern of `/price-changes`; `recomputeEventLights` closes `price_light` tasks when a light leaves red.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase (service-role, boundary cast), `@anthropic-ai/sdk` (new dep), shadcn/ui, `components/data-table.tsx` v2, `lib/audit.ts` `logAudit`, `lib/actions/task-actions.ts` `createTask`.

**Spec:** `docs/superpowers/specs/2026-09-09-price-light-design.md` — §5 (AI), §6.3–6.4 (recheck, tasks), §7.2–7.4 (screen, widget, guide), §11 (tests), §12 row 1. Phase 0 is on the branch (`0a64f20`, `1e01962`, `2751631`).

## Global Constraints

- **Never commit or push.** Each task ends with "stop and report"; the controller commits when Dor asks. No AI co-author lines.
- **Never apply migrations from the branch.** Phase 1 needs NO schema change (`ai_verdict`, `light_detail.override`, `light_silenced_until`, `tasks.source = price_light` already exist).
- **Worktree only:** `myt-backoffice/.claude/worktrees/feat-price-light`. No `cd` to the main checkout. Plain git commands only (a guard refuses compound/complex git).
- **AI is pinned to ONE call site:** `extractAndJudge()` in `lib/services/price-light-judge.ts`, called only from `price-light-match.ts`. `PRICE_LIGHT_AI=off` (and a missing `ANTHROPIC_API_KEY`) → rule-only, exactly phase-0 behaviour. Every failure → `unsure` with a note; **AI never throws past `matchEvent`**.
- **AI constants live only in the judge file:** `AI_CONFIDENCE_MIN 0.8`, `AI_TIMEOUT_MS 20000`, `AI_MAX_CANDIDATES 10`, `AI_DETAIL_TEXT_MAX 6000`, `AI_MODEL_DEFAULT "claude-opus-5"`, `AI_USD_PER_M_INPUT 5`, `AI_USD_PER_M_OUTPUT 25`. Light/normalization constants stay in `price-light.ts` untouched.
- **Page attrs win over AI attrs** (spec §5): merge order `{ ...ai, ...page }`.
- **One AI call per (event, listing) pair:** if the newest `competitor_matches` row for (event, competitor, scope) has `listing_id = candidate.id`, a non-null `ai_verdict`, and `listing_changed_at = listing.last_changed_at`, reuse it — no call.
- **Server Actions** return `{ ok: false, error }` instead of throwing; admin-only actions use `requireAdmin()`, staff actions `requireStaff()` (`lib/auth/guards.ts`). Every decision writes `logAudit({ action: "price_light.<x>", entityType: "event", entityId })`.
- **Supabase standard:** explicit selects, check `error` first, `console.error(JSON.stringify(error))`, one `const db = supabase as any` per file, no other `any`, no unguarded `!`. Soft deletes only (`softDeleteEvent`). Paged reads via `lib/supabase-paged.ts` (`fetchPaged`) wherever a query can exceed 1000 rows.
- **Silence = 14 days** (`SILENCE_DAYS 14` in the actions file); silenced red is excluded from "ממתינים להחלטה" but still red.
- **Task title format:** `אדום · חבילה · {name} {YYYY-MM-DD}` / `אדום · כרטיס · …`; `source: "price_light"`, `source_ref = { kind: "package"|"ticket", table: "events", row_id: eventId, label: name, url: "/events/{id}#fix-price" }`, `priority: "high"`. Dedupe on open task with same `row_id` + `kind`. Auto-close when the scope's light leaves red: `status: "done"`, description appended `"האור ירד מאדום אוטומטית ({date})"`.
- **Type gate:** `npx tsc --noEmit` clean for every touched file; lint = `ESLINT_USE_FLAT_CONFIG=false npx eslint --no-eslintrc --config .eslintrc.json --resolve-plugins-relative-to . <files>` (the worktree's `next lint` is broken by a parent-config collision).
- **`/guide`** updated in Task 7 (screen + actions are new staff flows).

---

## File map

| File | Responsibility |
| --- | --- |
| `lib/services/price-light-judge.ts` | `extractAndJudge`, `makeJudge`, cost accounting, prompt, JSON schema |
| `lib/services/price-light-match.ts` | judge wiring: default judge, extraction on rule-found listings, verdict cache |
| `lib/services/price-light-store.ts` | `closePriceLightTasksIfNotRed` called from `recomputeEventLights` |
| `lib/services/price-light-tasks.ts` | open / close `price_light` tasks (dedupe, title, description) |
| `lib/actions/price-light-actions.ts` | + `silenceRedLight`, `setLightOverride`, `clearLightOverride`, `openPriceLightTask`, `removeEventFromSite`, `listPriceLight`, `listCrawlRuns`, `triggerCrawl`, `aiCostThisMonth` |
| `lib/nav.ts` | "Price Light" entry in Products next to Price Changes |
| `app/(dashboard)/events/price-light-ui.ts` | shared client helpers moved out of `price-light-cell.tsx` (`LIGHT_SORT_ORDER`, `heLabel`, `HE_REASON`, `isLight`, `Pill`) |
| `app/(dashboard)/price-light/page.tsx`, `price-light-client.tsx`, `competitors-panel.tsx`, `decision-actions.tsx` | the screen |
| `components/price-light-widget.tsx`, `app/(dashboard)/dashboard/page.tsx` | dashboard bar |
| `scripts/price-light-judge-smoke.ts` | one real AI call on one event (manual, needs key) |
| `CLAUDE.md`, `.env.local`, `app/(dashboard)/guide/guide-content.ts`, spec §5 note | docs/env |

---

### Task 1: AI judge — `lib/services/price-light-judge.ts`

**Files:**
- Create: `lib/services/price-light-judge.ts`
- Create: `scripts/price-light-judge-smoke.ts`
- Modify: `package.json` (`npm install @anthropic-ai/sdk`), `.env.local` (`ANTHROPIC_API_KEY=`, `PRICE_LIGHT_AI=off`, `PRICE_LIGHT_AI_MODEL=`)

**Interfaces:**
- Consumes: `Judge` (`price-light-match.ts:19`), `LightEvent` (`price-light-store.ts`), `ListingRow`, `ExtractedAttrs`, `UNKNOWN_ATTRS` (`types/price-light.types.ts`).
- Produces: `aiEnabled(): boolean`, `aiModel(): string`, `extractAndJudge(input: JudgeInput): Promise<JudgeResult>`, `makeJudge(): Judge | null`, `interface JudgeInput { event: LightEvent; candidates: ListingRow[] }`, `interface AiVerdict { model; input_tokens; output_tokens; cost_usd; ms; same_event; confidence; matched_candidate_index; attrs; error?: string }`, `interface JudgeResult { same_event: boolean | "unknown"; confidence: number; matched_candidate_index: number | null; attrs: ExtractedAttrs; verdict: AiVerdict }`, the seven `AI_*` constants.

- [ ] **Step 1: Install the SDK**

```bash
npm install @anthropic-ai/sdk
```

- [ ] **Step 2: Write the judge**

```ts
// The ONLY place Claude is called for the price light (spec §5). Reads its input,
// returns a structured verdict, never throws past the caller.
import Anthropic from "@anthropic-ai/sdk";
import type { Judge } from "@/lib/services/price-light-match";
import type { LightEvent } from "@/lib/services/price-light-store";
import { UNKNOWN_ATTRS, type ExtractedAttrs, type ListingRow } from "@/types/price-light.types";

export const AI_CONFIDENCE_MIN = 0.8;
export const AI_TIMEOUT_MS = 20_000;
export const AI_MAX_CANDIDATES = 10;
export const AI_DETAIL_TEXT_MAX = 6_000;
export const AI_MODEL_DEFAULT = "claude-opus-5";
export const AI_USD_PER_M_INPUT = 5;
export const AI_USD_PER_M_OUTPUT = 25;

export interface JudgeInput { event: LightEvent; candidates: ListingRow[] }
export interface AiVerdict {
  model: string; input_tokens: number; output_tokens: number; cost_usd: number; ms: number;
  same_event: boolean | "unknown"; confidence: number; matched_candidate_index: number | null;
  attrs: ExtractedAttrs; error?: string;
}
export interface JudgeResult {
  same_event: boolean | "unknown"; confidence: number; matched_candidate_index: number | null;
  attrs: ExtractedAttrs; verdict: AiVerdict;
}

export function aiEnabled(): boolean {
  return process.env.PRICE_LIGHT_AI !== "off" && !!process.env.ANTHROPIC_API_KEY;
}
export function aiModel(): string { return process.env.PRICE_LIGHT_AI_MODEL || AI_MODEL_DEFAULT; }

const SYSTEM = `You compare an Israeli travel company's event package with a competitor's listing.
Answer ONLY through the tool. same_event = true only when artist/teams AND date (±1 day) AND city agree.
If several candidates are given, pick the one index that is the same event, else same_event=false.
Extract what the listing text says is included: bag_included (checked suitcase, not hand luggage),
direct_flight, hotel_stars, nights, breakfast, transfers. Use "unknown" when the text does not say.
Hebrew and English both appear; "טיסות ישירות" = direct, "לינה וארוחת בוקר" = breakfast, "תיק גב/טרולי בלבד" = no checked bag.`;

const TOOL = {
  name: "verdict",
  description: "Structured comparison result",
  input_schema: {
    type: "object" as const,
    properties: {
      same_event: { type: ["boolean", "string"], enum: [true, false, "unknown"] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      matched_candidate_index: { type: ["integer", "null"] },
      bag_included: { type: ["boolean", "string"], enum: [true, false, "unknown"] },
      direct_flight: { type: ["boolean", "string"], enum: [true, false, "unknown"] },
      hotel_stars: { type: ["integer", "string"], enum: [1, 2, 3, 4, 5, "unknown"] },
      nights: { type: ["integer", "string"] },
      breakfast: { type: ["boolean", "string"], enum: [true, false, "unknown"] },
      transfers: { type: ["boolean", "string"], enum: [true, false, "unknown"] },
    },
    required: ["same_event", "confidence", "matched_candidate_index", "bag_included", "direct_flight", "hotel_stars", "nights", "breakfast", "transfers"],
  },
};

function userPrompt(input: JudgeInput): string {
  const e = input.event;
  const ours = [
    `OUR EVENT: ${e.name}${e.name_english ? ` / ${e.name_english}` : ""}`,
    `date: ${e.date.slice(0, 10)} city: ${e.city ?? "?"} venue: ${e.venue ?? "?"}`,
    `travel: ${e.flight_departure_date ?? "?"} → ${e.flight_return_date ?? "?"}`,
  ].join("\n");
  const cands = input.candidates.slice(0, AI_MAX_CANDIDATES).map((c, i) => {
    const head = `[${i}] ${c.title}${c.title_he && c.title_he !== c.title ? ` / ${c.title_he}` : ""} | date ${c.event_date ?? "?"} | city ${c.city ?? "?"} | price ${c.price_from ?? "?"} ${c.currency ?? ""}`;
    const text = input.candidates.length === 1 && c.detail_text ? `\nLISTING TEXT:\n${c.detail_text.slice(0, AI_DETAIL_TEXT_MAX)}` : "";
    return head + text;
  }).join("\n");
  return `${ours}\n\nCOMPETITOR CANDIDATES:\n${cands}`;
}

function num(v: unknown): number | "unknown" { return typeof v === "number" && Number.isFinite(v) ? v : "unknown"; }
function bool(v: unknown): boolean | "unknown" { return typeof v === "boolean" ? v : "unknown"; }

export async function extractAndJudge(input: JudgeInput): Promise<JudgeResult> {
  const started = Date.now();
  const model = aiModel();
  const base: AiVerdict = { model, input_tokens: 0, output_tokens: 0, cost_usd: 0, ms: 0, same_event: "unknown", confidence: 0, matched_candidate_index: null, attrs: UNKNOWN_ATTRS };
  const fail = (error: string): JudgeResult => {
    const verdict = { ...base, ms: Date.now() - started, error };
    return { same_event: "unknown", confidence: 0, matched_candidate_index: null, attrs: UNKNOWN_ATTRS, verdict };
  };
  if (!aiEnabled()) return fail("ai disabled");
  if (input.candidates.length === 0) return fail("no candidates");
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: AI_TIMEOUT_MS, maxRetries: 1 });
    const res = await client.messages.create({
      model, max_tokens: 400, system: SYSTEM, tools: [TOOL], tool_choice: { type: "tool", name: "verdict" },
      messages: [{ role: "user", content: userPrompt(input) }],
    });
    const block = res.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") return fail("no tool_use block");
    const j = block.input as Record<string, unknown>;
    const inTok = res.usage.input_tokens, outTok = res.usage.output_tokens;
    const attrs: ExtractedAttrs = {
      bag_included: bool(j.bag_included), direct_flight: bool(j.direct_flight), hotel_stars: num(j.hotel_stars),
      nights: num(j.nights), breakfast: bool(j.breakfast), transfers: bool(j.transfers),
    };
    const same = typeof j.same_event === "boolean" ? j.same_event : "unknown";
    const confidence = typeof j.confidence === "number" ? Math.max(0, Math.min(1, j.confidence)) : 0;
    const idx = typeof j.matched_candidate_index === "number" && j.matched_candidate_index >= 0 && j.matched_candidate_index < input.candidates.length ? j.matched_candidate_index : null;
    const verdict: AiVerdict = {
      model, input_tokens: inTok, output_tokens: outTok,
      cost_usd: Math.round(((inTok * AI_USD_PER_M_INPUT + outTok * AI_USD_PER_M_OUTPUT) / 1_000_000) * 10_000) / 10_000,
      ms: Date.now() - started, same_event: same, confidence, matched_candidate_index: idx, attrs,
    };
    return { same_event: same, confidence, matched_candidate_index: idx, attrs, verdict };
  } catch (e) {
    console.error("price-light-judge: call failed", e instanceof Error ? e.message : e);
    return fail(e instanceof Error ? e.message : "call failed");
  }
}

/** Adapter for `matchEvent`'s `judge` option. null when AI is off. */
export function makeJudge(): Judge | null {
  if (!aiEnabled()) return null;
  return async ({ event, candidates }) => {
    const r = await extractAndJudge({ event, candidates });
    const verdict = r.verdict as unknown as Record<string, unknown>;
    if (r.same_event === true && r.confidence >= AI_CONFIDENCE_MIN && r.matched_candidate_index != null) {
      return { status: "found", listing: candidates[r.matched_candidate_index] ?? null, attrs: r.attrs, verdict };
    }
    if (r.same_event === false && r.confidence >= AI_CONFIDENCE_MIN) return { status: "not_selling", listing: null, attrs: null, verdict };
    return { status: "unsure", listing: null, attrs: null, verdict };
  };
}
```

Read `LightEvent` in `price-light-store.ts` first and use its real field names for date/city/venue/flight dates (adjust `userPrompt` accordingly). If the installed SDK's `tools`/`tool_choice` typings differ, adapt to them — the contract is "structured JSON through a forced tool call".

- [ ] **Step 3: Smoke script (manual)**

`scripts/price-light-judge-smoke.ts`: `node --env-file=.env.local scripts/price-light-judge-smoke.ts <eventId>` → loads the event with `loadEventForLight`, loads up to 5 `competitor_listings` within ±1 day for `liveevents`, calls `extractAndJudge`, prints the verdict + cost. Uses relative imports like `scripts/livetickets-brt-check.ts`, or documents that it needs `npx tsx` because of the `@/` chain. Do NOT run it unless `ANTHROPIC_API_KEY` is set; report whether it ran.

- [ ] **Step 4: Type gate + lint**, stop and report.

---

### Task 2: Wire the judge into the matcher

**Files:**
- Modify: `lib/services/price-light-match.ts`

**Interfaces:**
- Consumes: `makeJudge`, `AI_CONFIDENCE_MIN` (Task 1).
- Produces: `matchEvent`/`matchAllForEvent` unchanged signatures; `opts.judge` defaults to `makeJudge()` when `undefined` (explicit `null` = rule-only, used by tests/dry runs that must not spend money).

- [ ] **Step 1: Default judge + extraction on rule-found listings + cache**

In `matchEvent`:
1. `const judge = opts.judge === undefined ? makeJudge() : opts.judge;`
2. After the rule picks `picked` with a price (status `found`): if `judge` and `picked.detail_text` and the listing's `attrs` is null or every field is `"unknown"`, call the judge with `candidates: [picked]` for extraction only. Take `attrs` from the result; ignore its `same_event` (the rule already decided). Store `verdict`, `method: "ai"`.
3. Cache: before any judge call, if `prev` has `listing_id === picked.id`, `prev.ai_verdict != null` and `!hasListingChanged(prev, picked)` → reuse `prev.attrs`/`prev.ai_verdict` (`latestRow` must also select `ai_verdict, attrs`; extend `PrevRow`). No call.
4. When the rule fails and `judge` returns `found` with a listing whose `price_usd == null` → treat as quote-only (`unsure`, note `quote_only`), same as the rule path.
5. On a judge `unsure`, note = `ai unsure (confidence 0.xx)`; when `verdict.error` is set, note = `ai error: <msg>`.

- [ ] **Step 2: Cost never doubles:** `matchAllForEvent` builds the judge ONCE (`const judge = opts.judge === undefined ? makeJudge() : opts.judge`) and passes it to every `matchEvent` call.

- [ ] **Step 3: Type gate + lint**, run `node --env-file=.env.local scripts/price-light-selftest.ts` (engine untouched, sanity), stop and report.

---

### Task 3: Tasks — open, dedupe, auto-close

**Files:**
- Create: `lib/services/price-light-tasks.ts`
- Modify: `lib/services/price-light-store.ts` (`recomputeEventLights` calls `closePriceLightTasksIfNotRed` after the write, not under dryRun)

**Interfaces:**
- Consumes: `tasks` table columns (`types/task.types.ts`), `logAudit` (`lib/audit.ts`), `signedUsd` (engine).
- Produces: `openPriceLightTask(event: LightEvent, scope: Scope, detail: LightScopeDetail, history: MatchRow[], actor: { id: string | null }): Promise<{ ok: true; taskId: string; existed: boolean } | { ok: false; error: string }>`, `closePriceLightTasksIfNotRed(eventId: number, lights: Lights): Promise<number>`.

- [ ] **Step 1: Write the service**

```ts
import { supabase } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { signedUsd } from "@/lib/services/price-light";
import type { LightEvent, Lights } from "@/lib/services/price-light-store";
import type { LightScopeDetail, MatchRow, Scope } from "@/types/price-light.types";
import type { TaskSourceRef } from "@/types/task.types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const SCOPE_HE: Record<Scope, string> = { package: "חבילה", ticket: "כרטיס" };

function sourceRef(event: LightEvent, scope: Scope): TaskSourceRef {
  return { kind: scope, table: "events", row_id: event.id, label: event.name, url: `/events/${event.id}#fix-price` };
}

function description(scope: Scope, d: LightScopeDetail, history: MatchRow[]): string {
  const lines = [
    `שלנו: $${d.our_usd ?? "?"}`,
    `${d.competitor ?? "מתחרה"}: ${d.raw ?? "?"} ${d.raw_currency ?? ""} → מנורמל $${d.normalized_usd ?? "?"}`,
    d.adjustments.length ? `נרמול: ${d.adjustments.map((a) => a.label).join(", ")}` : "נרמול: אין",
    `הפרש: ${d.diff_usd != null ? signedUsd(d.diff_usd) : "?"}`,
    ...Object.entries(d.per_competitor).map(([k, v]) => `${k}: ${v.status}${v.normalized_usd != null ? ` $${v.normalized_usd}` : ""}`),
    "היסטוריה:",
    ...history.filter((m) => m.scope === scope).slice(0, 3).map((m) => `  ${m.created_at.slice(0, 10)} ${m.competitor} ${m.status} ${m.normalized_usd != null ? `$${m.normalized_usd}` : ""} ${m.diff_usd != null ? signedUsd(m.diff_usd) : ""}`),
  ];
  return lines.join("\n");
}

async function openTaskFor(eventId: number, scope: Scope): Promise<{ id: string } | null> {
  const { data, error } = await db.from("tasks").select("id").eq("source", "price_light").is("deleted_at", null)
    .in("status", ["todo", "in_progress"]).contains("source_ref", { row_id: eventId, kind: scope }).limit(1).maybeSingle();
  if (error) { console.error(JSON.stringify(error)); throw error; }
  return data ? { id: data.id } : null;
}

export async function openPriceLightTask(event: LightEvent, scope: Scope, detail: LightScopeDetail, history: MatchRow[], actor: { id: string | null }) {
  try {
    const existing = await openTaskFor(event.id, scope);
    if (existing) return { ok: true as const, taskId: existing.id, existed: true };
    const { data, error } = await db.from("tasks").insert({
      title: `אדום · ${SCOPE_HE[scope]} · ${event.name} ${event.date.slice(0, 10)}`,
      description: description(scope, detail, history), priority: "high", assignee_id: null, created_by: actor.id,
      source: "price_light", source_ref: sourceRef(event, scope),
    }).select("id").single();
    if (error || !data) { console.error(JSON.stringify(error)); return { ok: false as const, error: "task insert failed" }; }
    await logAudit({ action: "price_light.task_opened", entityType: "event", entityId: event.id, metadata: { scope, task_id: data.id } });
    return { ok: true as const, taskId: data.id, existed: false };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "failed" }; }
}

/** Called by recomputeEventLights after a write. Closes open price_light tasks whose scope is no longer red. */
export async function closePriceLightTasksIfNotRed(eventId: number, lights: Lights): Promise<number> {
  let closed = 0;
  for (const scope of ["package", "ticket"] as const) {
    if (lights[scope] === "red") continue;
    const task = await openTaskFor(eventId, scope).catch(() => null);
    if (!task) continue;
    const note = `האור ירד מאדום אוטומטית (${new Date().toISOString().slice(0, 10)})`;
    const { data: cur, error: readErr } = await db.from("tasks").select("description").eq("id", task.id).maybeSingle();
    if (readErr) { console.error(JSON.stringify(readErr)); continue; }
    const { error } = await db.from("tasks").update({ status: "done", completed_at: new Date().toISOString(), description: `${cur?.description ?? ""}\n${note}`.trim() }).eq("id", task.id);
    if (error) { console.error(JSON.stringify(error)); continue; }
    closed += 1;
    await logAudit({ action: "price_light.task_autoclosed", entityType: "event", entityId: eventId, metadata: { scope, task_id: task.id } });
  }
  return closed;
}
```

`tasks.source_ref` must be jsonb for `.contains()` — verify in `supabase/migrations/20260901174743_tasks.sql`; if it is `json`, filter in JS after selecting open `price_light` tasks (there are few).

- [ ] **Step 2: Hook into the store**: in `recomputeEventLights`, after the successful `events` update (and only when `!opts.dryRun`), `await closePriceLightTasksIfNotRed(eventId, after)` inside try/catch (log, never fail the recompute). Use a dynamic `import("@/lib/services/price-light-tasks")` to avoid a store↔tasks import cycle.

- [ ] **Step 3: Type gate + lint**, stop and report.

---

### Task 4: Server actions for the screen

**Files:**
- Modify: `lib/actions/price-light-actions.ts`

**Interfaces:**
- Produces (all `"use server"`; `type Ok = { ok: true } | { ok: false; error: string }`; `SILENCE_DAYS = 14` exported):
  - `silenceRedLight(eventId: number, days?: number): Promise<Ok>` — admin; `events.light_silenced_until = now + days`; audit `price_light.silenced`.
  - `setLightOverride(eventId, scope, light, note): Promise<Ok>` — admin; `note.trim().length >= 3` else error; writes `light_detail.override = { scope, light, note, by: session.email, at: ISO, competitor_normalized_usd: light_detail[scope]?.normalized_usd ?? null }` and `light_<scope> = light` (explicit column update, read-modify-write of `light_detail`); audit `price_light.override`.
  - `clearLightOverride(eventId): Promise<Ok>` — admin; removes `override`, then `recomputeEventLights(eventId, "manual")`; audit `price_light.override_cleared`.
  - `openPriceLightTask(eventId, scope): Promise<{ ok: true; taskId: string; existed: boolean } | { ok: false; error: string }>` — staff; `loadEventForLight` + `light_detail[scope]` + `listEventMatches(eventId).matches` → `price-light-tasks.openPriceLightTask(..., { id: session.sub })`.
  - `removeEventFromSite(eventId): Promise<Ok>` — admin; `softDeleteEvent(eventId)` (`lib/actions/event-actions.ts`) + audit `price_light.removed`.
  - `listPriceLight(): Promise<PriceLightRow[]>` — staff; every live future event (`is_deleted is null`, `date >= today`, paged) selecting `LIGHT_EVENT_COLUMNS` + `name,name_english,date,city,type`; one row per scope whose light is not `na`: `interface PriceLightRow { id: string /* "<eventId>:<scope>" */; event_id: number; name: string; date: string; city: string | null; kind: EventKind; scope: Scope; light: Light; diff_usd: number | null; our_usd: number | null; competitor: CompetitorKey | null; normalized_usd: number | null; raw: number | null; raw_currency: Currency | null; listing_url: string | null; adjustments: string[]; partial: boolean; reason: UncheckedReason | null; crawled_at: string | null; checked_at: string | null; silenced_until: string | null; has_open_task: boolean; changed_this_week: boolean; method: MatchMethod | null; override: LightOverride | null }`. `has_open_task` from ONE query of open `price_light` tasks keyed `${row_id}:${kind}`; `listing_url` + `method` + `changed_this_week` from ONE query of `competitor_matches` for the listed event ids (`created_at desc`, newest per event+scope, joined to `competitor_listings(url)`), `changed_this_week` = that newest row is < 7 days old.
  - `listCrawlRuns(): Promise<CrawlPanelRow[]>` — staff; per `ACTIVE_COMPETITORS`: `{ competitor, mode, intervalHours, last: { status, started_at, finished_at, listings, note } | null, nextDueAt: string | null, circuitOpen: boolean, totalListings: number }` (`circuitOpen` from `price-light-crawl.ts`; `totalListings` via `select("id", { count: "exact", head: true })`).
  - `triggerCrawl(competitor: CompetitorKey, dryRun = false): Promise<{ ok: true; summary: CrawlSummary } | { ok: false; error: string }>` — admin; validates against `ACTIVE_COMPETITORS`; `runCrawl(competitor, "manual", { dryRun })`.
  - `aiCostThisMonth(): Promise<{ usd: number; calls: number }>` — staff; `competitor_matches` rows with `created_at >= <first of month UTC>` and `ai_verdict not null` (select `ai_verdict`, paged), sum `cost_usd`.

- [ ] **Step 1: Write the actions** (keep `recheckEvent`/`listEventMatches` as they are). Read `lib/auth/guards.ts` for `requireAdmin` and the session shape (`email`, `sub`), and `lib/supabase-paged.ts` for `fetchPaged`.

- [ ] **Step 2: Type gate + lint**, stop and report.

---

### Task 5: `/price-light` screen

**Files:**
- Create: `app/(dashboard)/events/price-light-ui.ts` — move `LIGHT_SORT_ORDER`, `heLabel`, `HE_REASON`, `isLight`, the `PILL` colour map and the `Pill` component out of `app/(dashboard)/events/price-light-cell.tsx` (which then imports them). No behaviour change in the events table.
- Modify: `lib/nav.ts` (Products group, right after "Price Changes"): `{ name: "Price Light", href: "/price-light", icon: <an existing lucide icon, e.g. Gauge>, keywords: "רמזור מתחרים competitor", roles: ADMIN_ROLES }`.
- Create: `app/(dashboard)/price-light/page.tsx` (server: `PageHeader` title "רמזור מחירים", description "מה המתחרים מבקשים על אותו אירוע, ומה עושים עם אדום."), `price-light-client.tsx` ("use client"), `competitors-panel.tsx`, `decision-actions.tsx`.

**Interfaces:**
- Consumes: Task 4 actions; `lightLabel`, `signedUsd` (engine); the shared UI module above; shadcn `AlertDialog`, `Popover`, `Select`, `Textarea`, `Tooltip`, `Badge`, `Button`; `useToast`.

- [ ] **Step 1: `price-light-client.tsx`** — pattern = `app/(dashboard)/price-changes/price-changes-client.tsx`:
  - state `rows`, `runs`, `cost`, `loading`, `view`; `reload()` = `Promise.all([listPriceLight(), listCrawlRuns(), aiCostThisMonth()])`; `useEffect` on mount reads `?f=` (`useSearchParams`) to preselect `view`.
  - **Tiles** (6): alone, green, orange, red, unchecked, "ממתינים להחלטה" (`light === "red" && !silenced_until-in-future && !has_open_task`); counts from `rows`; click sets `view`.
  - **Views** (`DataTable` `views`): `pending` (default), `red`, `orange_plus`, `package`, `ticket`, `soon` (date within 45 days), `partial`, `changed`, `unchecked`, `ai_sample` (`method === "ai"`), `all`.
  - **Columns**: event (link `/events/{id}`, date under it), scope pill, our `$`, competitor (name + `raw raw_currency → $normalized` + adjustment chips + external link icon to `listing_url`), diff (`signedUsd`, green/red text), light `Pill`, "נסרק" (relative time), decision → `<DecisionActions row onDone={reload} />`.
  - `defaultSorting=[{ id: "diff_usd", desc: true }]`, `searchColumns=["name","competitor"]`, `dense`, `emptyState` per view.
  - Header line above the tiles: `AI החודש: $X · N קריאות · מתחרים פעילים: …` (from `runs`).
- [ ] **Step 2: `decision-actions.tsx`** — for red rows the four buttons; for every row "בדוק עכשיו" + "דריסה":
  - **הוזל** → `Link` to `/events/{id}#fix-price`.
  - **השאר בפיד** → `silenceRedLight(event_id)` → toast `מושתק עד {date}`.
  - **הסר מהאתר** → `AlertDialog` (title "להסיר את האירוע מהאתר?", body name + date, destructive confirm) → `removeEventFromSite`.
  - **משימה** → `openPriceLightTask(event_id, scope)` → toast `משימה נפתחה` / `יש כבר משימה פתוחה` with a link to `/tasks`.
  - **דריסה** → `Popover` with `Select` of the 5 lights + `Textarea` note (required) → `setLightOverride`; when `row.override` exists show "בטל דריסה" → `clearLightOverride`.
  - **בדוק עכשיו** → `recheckEvent` → `onDone()`.
  - Every action: `useToast` on `{ ok: false }`, buttons disabled while busy (`busy` flag, `finally`).
- [ ] **Step 3: `competitors-panel.tsx`** — one card per `CrawlPanelRow`: name, last-status `Badge` (`ok` success, `partial` warning, `blocked`/`error` destructive, `skipped` muted, none → "טרם נסרק"), "נסרק לפני X שעות", `totalListings`, "הבא: {nextDueAt}", "בלם פתוח" badge when `circuitOpen`, button "סרוק עכשיו" (`triggerCrawl(key)`; disabled with tooltip "מתרענן בלילה מה-API" when `mode === "table"`; spinner while running — a crawl can take up to 4 minutes — then `onDone()`).
- [ ] **Step 4: Type gate + lint** for all new/changed files, `npm run build` once (the new route must compile; the build ignores TS errors by config so watch for "Module not found"), stop and report with the file list.

---

### Task 6: Dashboard widget

**Files:**
- Create: `components/price-light-widget.tsx` (server component: `listPriceLight()` → counts per light + pending; a segmented bar with the five colours and the line "N אדומים · M ממתינים להחלטה"; the card links to `/price-light?f=pending`).
- Modify: `app/(dashboard)/dashboard/page.tsx` — render `<PriceLightWidget />` in the same grid as `<MyTasksWidget />` / `<CreativeGapsPanel />` (`page.tsx:75-76`), gated the way that page gates admin-only cards (read the file; if it has no gating, gate on `ADMIN_ROLES` via the session helper the page already uses).

- [ ] **Step 1: Build it**, **Step 2: Type gate + lint**, stop and report.

---

### Task 7: Docs, env, guide

**Files:**
- Modify: `CLAUDE.md` — Price light section: AI judge (one call site, cache per (event, listing), cost constants, `PRICE_LIGHT_AI` stays `off` until the key is set in Vercel), `/price-light` actions + audit actions, tasks open/auto-close; env block: `ANTHROPIC_API_KEY=` (server-only, our account), `PRICE_LIGHT_AI` (`off`/`on`), `PRICE_LIGHT_AI_MODEL` (default `claude-opus-5`).
- Modify: `app/(dashboard)/guide/guide-content.ts` — extend the `price-light` section (EN+HE): the screen, the four decisions and what each writes, override + mandatory note, silence 14 days, task opens/auto-closes, the AI cost line, "סרוק עכשיו".
- Modify: `docs/superpowers/specs/2026-09-09-price-light-design.md` §5 — one line: extraction also runs on rule-found listings with unknown attrs; verdicts cached per (event, listing, `last_changed_at`).

- [ ] **Step 1: Edit**, **Step 2: `npx tsc --noEmit 2>&1 | grep guide-content` → empty**, stop and report.

---

## Self-review

- Spec coverage: §5 (T1–T2), §6.3 "סרוק אתר עכשיו" (T4/T5), §6.4 (T3/T4/T5), §7.2 (T4/T5), §7.3 (T6), §7.4 (T7), §10 env (T1/T7), §11 manual checklist → the controller's verification list once the branch runs on a preview with `ANTHROPIC_API_KEY`.
- Type consistency: the `Judge` return shape (`status`, `listing`, `attrs`, `verdict`) matches `price-light-match.ts:19-20`; `LightScopeDetail`/`Lights`/`MatchRow`/`LightOverride` names match `types/price-light.types.ts` and the store; `TaskSourceRef` fields match `types/task.types.ts:27-36`; `CrawlSummary` from `price-light-crawl.ts`.
- Out of scope (their own phases): D1 provider, phase-2 crawlers (`docs/superpowers/scrapers/phase2-recon.md`), main-site sorting/tabs (phase 3), Batch API.
