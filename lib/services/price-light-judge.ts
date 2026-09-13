// The ONLY place Claude is called for the price light (spec §5). Reads its input,
// returns a structured verdict, never throws past the caller.
import Anthropic from "@anthropic-ai/sdk";
import type { Judge } from "@/lib/services/price-light-match";
import type { LightEvent } from "@/lib/services/price-light-store";
import { UNKNOWN_ATTRS, type ExtractedAttrs, type ListingRow } from "@/types/price-light.types";

export const AI_CONFIDENCE_MIN = 0.8;
// 12s, not 20s, and no SDK retry: the nightly checks its wall-clock budget only
// BETWEEN events, so a slow call inside one event is time the budget can't see.
// Two events' worth of hung calls used to be enough to strand the tail of the run.
export const AI_TIMEOUT_MS = 12_000;
/** Hard ceiling on judge calls in ONE nightly pass - the run-wide budget the
 *  nightly threads through `matchAllForEvent`. Past it, matching carries on
 *  rule-only for the rest of the run instead of eating the whole cron window. */
export const AI_CALLS_PER_RUN = 40;
export const AI_MAX_CANDIDATES = 10;
export const AI_DETAIL_TEXT_MAX = 6_000;
export const AI_MODEL_DEFAULT = "claude-opus-5";
export const AI_USD_PER_M_INPUT = 5;
export const AI_USD_PER_M_OUTPUT = 25;

export interface JudgeInput { event: LightEvent; candidates: ListingRow[] }
/** `memory` = the agent's house rules + staff corrections (price-light-memory.ts). Omitted
 *  (ad-hoc callers, smoke test) = the base system prompt alone, exactly as before. */
export interface JudgeOptions { memory?: string | null }
export interface AiVerdict {
  model: string; input_tokens: number; output_tokens: number; cost_usd: number; ms: number;
  same_event: boolean | "unknown"; confidence: number; matched_candidate_index: number | null;
  attrs: ExtractedAttrs; error?: string;
}
export interface JudgeResult {
  same_event: boolean | "unknown"; confidence: number; matched_candidate_index: number | null;
  attrs: ExtractedAttrs; verdict: AiVerdict; listing: ListingRow | null;
}

/** Every Anthropic console key starts with this. A placeholder never does. */
const KEY_PREFIX = "sk-ant-";
let keyWarned = false;

/**
 * The key, or null when what is configured is not one. The env var is expected to sit in
 * Vercel as an empty slot until a real key from console.anthropic.com is pasted in, so the
 * shape check is what keeps a slot (or a half-pasted value) from being treated as a
 * credential: without it, `ANTHROPIC_API_KEY=REPLACE_ME` plus `PRICE_LIGHT_AI=on` would look
 * enabled and turn every match into a 401 that reads as `unsure` with no hint why.
 */
export function anthropicKey(): string | null {
  const raw = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  return raw.startsWith(KEY_PREFIX) ? raw : null;
}

/**
 * Opt-in, never fail-open: the AI is off unless PRICE_LIGHT_AI is literally "on"
 * AND a real key is present. A typo, an empty string, a placeholder or an unset var costs
 * nothing and falls back to rule-only matching - the money side must never turn itself on by
 * accident (e.g. someone clearing the var to "disable" it). When the switch is on but the key
 * is not usable, say so ONCE per process: silently doing nothing is the confusing outcome.
 */
export function aiEnabled(): boolean {
  if (process.env.PRICE_LIGHT_AI !== "on") return false;
  if (anthropicKey()) return true;
  if (!keyWarned) {
    keyWarned = true;
    const raw = (process.env.ANTHROPIC_API_KEY ?? "").trim();
    console.warn(
      `price-light-judge: PRICE_LIGHT_AI=on but ANTHROPIC_API_KEY is ${raw ? `not a console key (expected it to start with "${KEY_PREFIX}")` : "empty"} - matching stays rule-only.`,
    );
  }
  return false;
}
export function aiModel(): string { return process.env.PRICE_LIGHT_AI_MODEL || AI_MODEL_DEFAULT; }

/** Hard ceiling on the memory block, characters - a runaway prompt is a runaway bill. */
export const AI_MEMORY_MAX = 2_000;

const SYSTEM = `You compare an Israeli travel company's event package with a competitor's listing.
Answer ONLY through the tool. same_event = true only when artist/teams AND date (±1 day) AND city agree.
If several candidates are given, pick the one index that is the same event, else same_event=false.
Extract what the listing text says is included: bag_included (checked suitcase, not hand luggage),
direct_flight, hotel_stars, nights, breakfast, transfers. Use "unknown" when the text does not say.
Hebrew and English both appear; "טיסות ישירות" = direct, "לינה וארוחת בוקר" = breakfast, "תיק גב/טרולי בלבד" = no checked bag.`;

/** Base prompt + whatever the agent has learned so far. Trimmed, because the memory block is
 *  assembled from staff-written notes and rides along on every single call. */
function systemPrompt(memory: string | null | undefined): string {
  const extra = (memory ?? "").trim();
  return extra ? `${SYSTEM}\n\n${extra.slice(0, AI_MEMORY_MAX)}` : SYSTEM;
}

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

// LightEvent (price-light-store.ts) has no `city`/`venue`/`flight_departure_date` fields -
// city lives on `location.name`, there is no venue on the light-quote projection, and the
// travel window is `def_date_depart`/`def_date_return`. Adjusted from the brief accordingly.
// `shown` MUST be the same array the caller validates `matched_candidate_index` against -
// the model only ever sees these, so an index outside `shown` must never resolve to a listing.
function userPrompt(event: LightEvent, shown: ListingRow[]): string {
  const ours = [
    `OUR EVENT: ${event.name}${event.name_english ? ` / ${event.name_english}` : ""}`,
    `date: ${event.date.slice(0, 10)} city: ${event.location?.name ?? "?"}`,
    `travel: ${event.def_date_depart ?? "?"} → ${event.def_date_return ?? "?"}`,
  ].join("\n");
  const cands = shown.map((c, i) => {
    const when = c.event_date ?? (c.travel_depart && c.travel_return ? `travel ${c.travel_depart}..${c.travel_return} (match date not published)` : "?");
    const head = `[${i}] ${c.title}${c.title_he && c.title_he !== c.title ? ` / ${c.title_he}` : ""} | date ${when} | city ${c.city ?? "?"} | price ${c.price_from ?? "?"} ${c.currency ?? ""}`;
    const text = shown.length === 1 && c.detail_text ? `\nLISTING TEXT:\n${c.detail_text.slice(0, AI_DETAIL_TEXT_MAX)}` : "";
    return head + text;
  }).join("\n");
  return `${ours}\n\nCOMPETITOR CANDIDATES:\n${cands}`;
}

function num(v: unknown): number | "unknown" { return typeof v === "number" && Number.isFinite(v) ? v : "unknown"; }
function bool(v: unknown): boolean | "unknown" { return typeof v === "boolean" ? v : "unknown"; }

export async function extractAndJudge(input: JudgeInput, opts: JudgeOptions = {}): Promise<JudgeResult> {
  const started = Date.now();
  const model = aiModel();
  const base: AiVerdict = { model, input_tokens: 0, output_tokens: 0, cost_usd: 0, ms: 0, same_event: "unknown", confidence: 0, matched_candidate_index: null, attrs: UNKNOWN_ATTRS };
  const fail = (error: string): JudgeResult => {
    const verdict = { ...base, ms: Date.now() - started, error };
    return { same_event: "unknown", confidence: 0, matched_candidate_index: null, attrs: UNKNOWN_ATTRS, verdict, listing: null };
  };
  if (!aiEnabled()) return fail("ai disabled");
  if (input.candidates.length === 0) return fail("no candidates");
  // Slice ONCE - the model only ever sees `shown`, so both the prompt and the bounds
  // check below must agree on this array. A hallucinated index past `shown.length`
  // (e.g. 10..N when there are >AI_MAX_CANDIDATES raw candidates) must never resolve
  // against the unsliced `input.candidates` - that would "find" a listing the model
  // never saw.
  const shown = input.candidates.slice(0, AI_MAX_CANDIDATES);
  try {
    // maxRetries 0: a retry doubles the wall-clock cost of one event inside the
    // nightly's between-events budget check, and a failed verdict is already a
    // harmless `unsure` that the next visit retries anyway.
    // `anthropicKey()` rather than the raw env var: aiEnabled() already proved it is a real
    // key, and going through the same accessor means a placeholder can never reach the client.
    const client = new Anthropic({ apiKey: anthropicKey() ?? undefined, timeout: AI_TIMEOUT_MS, maxRetries: 0 });
    const res = await client.messages.create({
      model, max_tokens: 4_000, system: systemPrompt(opts.memory), tools: [TOOL], tool_choice: { type: "tool", name: "verdict" },
      // Opus 5 thinks adaptively by default, so the reasoning tokens come out of
      // max_tokens BEFORE the forced tool call - 400 truncated the answer away.
      // Low effort + a real ceiling keeps the verdict cheap and complete.
      output_config: { effort: "low" },
      messages: [{ role: "user", content: userPrompt(input.event, shown) }],
    });
    // Truncated before the tool block was emitted - anything found below would be partial.
    if (res.stop_reason === "max_tokens") return fail("truncated");
    const block = res.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") return fail("no tool_use block");
    // External model output - one boundary cast (repo pattern), narrowed field-by-field below.
    const j = block.input as Record<string, unknown>;
    const inTok = res.usage.input_tokens, outTok = res.usage.output_tokens;
    const attrs: ExtractedAttrs = {
      bag_included: bool(j.bag_included), direct_flight: bool(j.direct_flight), hotel_stars: num(j.hotel_stars),
      nights: num(j.nights), breakfast: bool(j.breakfast), transfers: bool(j.transfers),
    };
    const same = typeof j.same_event === "boolean" ? j.same_event : "unknown";
    const confidence = typeof j.confidence === "number" ? Math.max(0, Math.min(1, j.confidence)) : 0;
    const idx = typeof j.matched_candidate_index === "number" && j.matched_candidate_index >= 0 && j.matched_candidate_index < shown.length ? j.matched_candidate_index : null;
    const listing = idx != null ? shown[idx] : null;
    const verdict: AiVerdict = {
      model, input_tokens: inTok, output_tokens: outTok,
      cost_usd: Math.round(((inTok * AI_USD_PER_M_INPUT + outTok * AI_USD_PER_M_OUTPUT) / 1_000_000) * 10_000) / 10_000,
      ms: Date.now() - started, same_event: same, confidence, matched_candidate_index: idx, attrs,
    };
    return { same_event: same, confidence, matched_candidate_index: idx, attrs, verdict, listing };
  } catch (e) {
    console.error("price-light-judge: call failed", e instanceof Error ? e.message : JSON.stringify(e));
    return fail(e instanceof Error ? e.message : "call failed");
  }
}

/** Adapter for `matchEvent`'s `judge` option. null when AI is off. `memory` is loaded ONCE per
 *  run by the caller (price-light-nightly.ts) and closed over here, so a pass of 400 events
 *  costs one audit-log read, not 400. */
export function makeJudge(memory?: string | null): Judge | null {
  if (!aiEnabled()) return null;
  return async ({ event, candidates }) => {
    const r = await extractAndJudge({ event, candidates }, { memory });
    // AiVerdict has no index signature - one boundary cast to the loose jsonb-shaped type
    // `Judge` expects, same rationale as the tool_use cast above.
    const verdict = r.verdict as unknown as Record<string, unknown>;
    // `r.listing` was already resolved against the SAME sliced array the model saw
    // (see `extractAndJudge`) - never re-index the raw `candidates` here.
    if (r.same_event === true && r.confidence >= AI_CONFIDENCE_MIN && r.listing != null) {
      return { status: "found", listing: r.listing, attrs: r.attrs, verdict };
    }
    if (r.same_event === false && r.confidence >= AI_CONFIDENCE_MIN) return { status: "not_selling", listing: null, attrs: null, verdict };
    return { status: "unsure", listing: null, attrs: null, verdict };
  };
}
