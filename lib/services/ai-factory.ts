// AI Factory reads (spec docs/superpowers/specs/2026-09-16-price-light-gaps-ai-factory-design.md
// §5, §8) - one screen per agent showing its identity, memory, decision log and maturity.
// Server-only, called directly from the (already `requireAdmin()`-guarded) page.tsx files;
// mutations live in lib/actions/ai-factory-actions.ts instead, because only a "use server" file
// can be called from a client component.
import {
  AGENT_KEYS, AGENTS_MASTER_SWITCH_ENV, agentFor, agentModel, agentsMasterSwitchOff, anthropicKey,
  maturityFrom, MATURITY_MIN_DECISIONS, memoryBlock, TAUGHT_RULES_MAX, traceAgentLessons, type AgentDefinition, type AgentKey,
  type MaturityRow,
} from "@/lib/agents";
import { aiCostThisMonth } from "@/lib/actions/price-light-actions";
import { supabase } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";
import type {
  AgentDetail, AgentLogPage, AgentLogRow, AgentMaturityDetail, AgentOverviewRow, AgentSettings,
  AgentSwitchState, MaturityWeekPoint, TaughtRule,
} from "@/types/ai-factory.types";

// `agent_instructions` / `audit_log` / `competitor_matches` predate the generated DB types on
// some columns used here - one boundary cast (repo pattern).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const AGENT_LOG_PAGE_SIZE = 25;
/** Paged reads never run away past this many rows (repo pattern, see lib/supabase-paged.ts). */
const AUDIT_FETCH_MAX = 20_000;
const FEEDBACK_FETCH_MAX = 500;

/** Postgres "undefined_table" / PostgREST "table not in schema cache" - the migration hasn't run. */
export function isMissingTableError(error: { code?: string } | null | undefined): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

/** One level more specific than `agentEnabled()` - which gate is actually closed. */
export function switchStateFor(def: AgentDefinition): AgentSwitchState {
  if (agentsMasterSwitchOff()) return "master_off";
  if ((process.env[def.switchEnv] ?? "") !== "on") return "off";
  if (!anthropicKey()) return "key_missing";
  return "on";
}

function settingsFor(def: AgentDefinition): AgentSettings {
  return {
    model: agentModel(def),
    callsPerRun: def.callsPerRun,
    confidenceMin: def.confidenceMin,
    timeoutMs: def.timeoutMs,
    usdPerMInput: def.usdPerMInput,
    usdPerMOutput: def.usdPerMOutput,
    memoryMaxChars: def.memoryMaxChars,
    lessonMax: def.lessonMax,
    lessonLookbackDays: def.lessonLookbackDays,
    switchEnv: def.switchEnv,
    modelEnv: def.modelEnv ?? null,
    keyEnv: "ANTHROPIC_API_KEY",
    masterSwitchEnv: AGENTS_MASTER_SWITCH_ENV,
  };
}

/** Only the price-light agent writes AI spend today - every other key reads as zero until it has
 *  its own call site. Keeps this file from needing to know each agent's cost table by name. */
async function costAndCallsFor(key: AgentKey): Promise<{ usd: number; calls: number }> {
  if (key !== "price-light") return { usd: 0, calls: 0 };
  return aiCostThisMonth();
}

/** Per agent: identity basics, switch state, model, this month's AI spend, and its maturity rate.
 *  The card grid on `/ai-factory`. */
export async function listAgentsOverview(): Promise<AgentOverviewRow[]> {
  const rows: AgentOverviewRow[] = [];
  for (const key of AGENT_KEYS) {
    const def = agentFor(key);
    const [cost, maturity] = await Promise.all([costAndCallsFor(key), loadMaturity(key)]);
    rows.push({
      key,
      title: def.title,
      switchState: switchStateFor(def),
      model: agentModel(def),
      costUsdThisMonth: cost.usd,
      callsThisMonth: cost.calls,
      maturityRate: maturity.rate,
    });
  }
  return rows;
}

interface TaughtRuleRow {
  id: string;
  text: string;
  active: boolean;
  created_by: string | null;
  created_at: string;
  deactivated_at: string | null;
}

/** Every taught rule for this agent, active and inactive, newest first - the "זיכרון ולימוד"
 *  tab's management list (as opposed to lib/agents/memory.ts's active-only, capped-at-12 read
 *  that actually rides on a call). A missing table reads as "nothing taught yet" rather than an
 *  error - the UI's empty state already covers that, and the add/deactivate actions are the ones
 *  that need to say "המיגרציה עוד לא רצה" explicitly. */
async function listTaughtRules(agentKey: AgentKey): Promise<TaughtRule[]> {
  try {
    const { data, error } = await db
      .from("agent_instructions")
      .select("id,text,active,created_by,created_at,deactivated_at")
      .eq("agent_key", agentKey)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      if (!isMissingTableError(error)) console.error("listTaughtRules failed", JSON.stringify(error));
      return [];
    }
    return ((data ?? []) as TaughtRuleRow[]).map((r) => ({
      id: r.id,
      text: r.text,
      active: r.active,
      createdBy: r.created_by,
      createdAt: r.created_at,
      deactivatedAt: r.deactivated_at,
    }));
  } catch (e) {
    console.error("listTaughtRules failed", e);
    return [];
  }
}

/** Everything the `/ai-factory/[key]` page renders across its four tabs. */
export async function getAgentDetail(key: AgentKey): Promise<AgentDetail> {
  const def = agentFor(key);
  const [trace, taughtRules] = await Promise.all([traceAgentLessons(def), listTaughtRules(key)]);
  const lessons = trace.filter((t) => t.status === "quoted").map((t) => t.line ?? "");
  const activeTaught = taughtRules.filter((r) => r.active).slice(0, TAUGHT_RULES_MAX).map((r) => r.text);
  return {
    key,
    title: def.title,
    role: def.role,
    decides: def.decides,
    neverDoes: def.neverDoes,
    humanDecides: def.humanDecides,
    switchState: switchStateFor(def),
    settings: settingsFor(def),
    houseRules: def.houseRules(),
    lessons,
    trace,
    promptPreview: memoryBlock(def, lessons, activeTaught).slice(0, def.memoryMaxChars),
    taughtRules,
  };
}

interface CompetitorMatchRow {
  id: number;
  event_id: number;
  competitor: string;
  scope: string;
  status: string;
  created_at: string;
  ai_verdict: {
    same_event?: boolean | "unknown";
    confidence?: number;
    note?: string;
    error?: string;
    cached?: boolean;
    cost_usd?: number;
    model?: string;
  } | null;
}

interface FeedbackMetadata {
  match_id?: number;
  verdict_ok?: boolean;
  note?: string;
}

/** Newest `agent.feedback` per match_id, restricted to the ids this page actually shows. A plain
 *  recency-ordered scan (capped at FEEDBACK_FETCH_MAX) rather than a jsonb `->>` filter - low
 *  volume, and it keeps this off Postgrest's operator-string edge cases. */
async function feedbackByMatchId(matchIds: number[]): Promise<Map<number, { verdictOk: boolean; note: string | null; at: string }>> {
  const wanted = new Set(matchIds);
  const out = new Map<number, { verdictOk: boolean; note: string | null; at: string }>();
  if (wanted.size === 0) return out;
  const { data, error } = await db
    .from("audit_log")
    .select("metadata,created_at")
    .eq("action", "agent.feedback")
    .order("created_at", { ascending: false })
    .limit(FEEDBACK_FETCH_MAX);
  if (error) {
    console.error("feedbackByMatchId failed", JSON.stringify(error));
    return out;
  }
  for (const row of (data ?? []) as { metadata: FeedbackMetadata | null; created_at: string }[]) {
    const matchId = row.metadata?.match_id;
    if (typeof matchId !== "number" || !wanted.has(matchId) || out.has(matchId)) continue;
    out.set(matchId, {
      verdictOk: row.metadata?.verdict_ok === true,
      note: typeof row.metadata?.note === "string" ? row.metadata.note : null,
      at: row.created_at,
    });
  }
  return out;
}

/** The price-light judge's AI calls, newest first, 25/page - the "יומן" tab. Only the price-light
 *  agent writes `competitor_matches.ai_verdict` today; any other key reads as an empty page. */
export async function listAgentLog(key: AgentKey, page: number): Promise<AgentLogPage> {
  if (key !== "price-light") return { rows: [], page, pageSize: AGENT_LOG_PAGE_SIZE, hasMore: false };
  const from = Math.max(0, page) * AGENT_LOG_PAGE_SIZE;
  // One extra row asked for, never shown - just to know whether a next page exists.
  const { data, error } = await db
    .from("competitor_matches")
    .select("id,event_id,competitor,scope,status,created_at,ai_verdict")
    .not("ai_verdict", "is", null)
    .order("created_at", { ascending: false })
    .range(from, from + AGENT_LOG_PAGE_SIZE);
  if (error) {
    console.error("listAgentLog failed", JSON.stringify(error));
    return { rows: [], page, pageSize: AGENT_LOG_PAGE_SIZE, hasMore: false };
  }
  const matches = (data ?? []) as CompetitorMatchRow[];
  const hasMore = matches.length > AGENT_LOG_PAGE_SIZE;
  const pageRows = hasMore ? matches.slice(0, AGENT_LOG_PAGE_SIZE) : matches;

  const eventIds = [...new Set(pageRows.map((m) => m.event_id))];
  const eventNames = new Map<number, string>();
  if (eventIds.length > 0) {
    const { data: events, error: eventsError } = await db.from("events").select("id,name").in("id", eventIds);
    if (eventsError) console.error("listAgentLog: event name read failed", JSON.stringify(eventsError));
    for (const e of (events ?? []) as { id: number; name: string }[]) eventNames.set(e.id, e.name);
  }
  const feedback = await feedbackByMatchId(pageRows.map((m) => m.id));

  const rows: AgentLogRow[] = pageRows.map((m) => ({
    id: m.id,
    eventId: m.event_id,
    eventName: eventNames.get(m.event_id) ?? null,
    competitor: m.competitor,
    scope: m.scope,
    status: m.status,
    createdAt: m.created_at,
    verdict: {
      sameEvent: m.ai_verdict?.same_event ?? null,
      confidence: typeof m.ai_verdict?.confidence === "number" ? m.ai_verdict.confidence : null,
      note: typeof m.ai_verdict?.note === "string" ? m.ai_verdict.note : null,
      error: typeof m.ai_verdict?.error === "string" ? m.ai_verdict.error : null,
      cached: typeof m.ai_verdict?.cached === "boolean" ? m.ai_verdict.cached : null,
      costUsd: typeof m.ai_verdict?.cost_usd === "number" ? m.ai_verdict.cost_usd : null,
      model: typeof m.ai_verdict?.model === "string" ? m.ai_verdict.model : null,
    },
    feedback: feedback.get(m.id) ?? null,
  }));

  return { rows, page, pageSize: AGENT_LOG_PAGE_SIZE, hasMore };
}

/** Monday-based ISO week start (UTC), so a run at any hour of the day lands in the same bucket. */
function weekStartOf(iso: string): string {
  const d = new Date(iso);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = day.getUTCDay(); // 0 = Sunday
  const backToMonday = dow === 0 ? 6 : dow - 1;
  day.setUTCDate(day.getUTCDate() - backToMonday);
  return day.toISOString().slice(0, 10);
}

function weeklySeriesFrom(rows: MaturityRow[], createdAtOf: Map<MaturityRow, string>, weeks: number): MaturityWeekPoint[] {
  const starts: string[] = [];
  const now = new Date();
  for (let i = weeks - 1; i >= 0; i -= 1) {
    starts.push(weekStartOf(new Date(now.getTime() - i * 7 * 86_400_000).toISOString()));
  }
  const buckets = new Map<string, { agreed: number; disagreed: number }>(starts.map((s) => [s, { agreed: 0, disagreed: 0 }]));
  for (const row of rows) {
    const at = createdAtOf.get(row);
    if (!at) continue;
    const bucket = buckets.get(weekStartOf(at));
    if (!bucket) continue; // outside the window we asked for
    const one = maturityFrom([row]);
    bucket.agreed += one.agreed;
    bucket.disagreed += one.disagreed;
  }
  return starts.map((weekStart) => ({ weekStart, ...buckets.get(weekStart)! }));
}

const MATURITY_ACTIONS = [
  "price_light.repriced", "price_light.removed", "price_light.sold_out",
  "price_light.silenced", "price_light.override", "price_light.corrected", "agent.feedback",
];
const WEEKLY_WEEKS = 8;

/** Maturity over the last `days` (rate) plus an 8-week weekly series (chart) - the "בשלות" tab.
 *  Pages past PostgREST's 1000-row cap (fetchPaged) because a busy agent easily clears that many
 *  audit rows well inside 8 weeks. */
export async function loadMaturity(agentKey: AgentKey, days = 30): Promise<AgentMaturityDetail> {
  const windowDays = Math.max(days, WEEKLY_WEEKS * 7);
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const { rows, error, truncated } = await fetchPaged<{ id: number; action: string; metadata: Record<string, unknown> | null; created_at: string }>(
    () =>
      db
        .from("audit_log")
        .select("id,action,metadata,created_at")
        .in("action", MATURITY_ACTIONS)
        .gte("created_at", since)
        .order("id", { ascending: true }),
    AUDIT_FETCH_MAX,
  );
  if (error) console.error("loadMaturity failed", JSON.stringify(error));
  if (truncated) console.error(`loadMaturity: truncated at ${AUDIT_FETCH_MAX}`);

  // `agent.feedback` is shared across every agent - only this agent's own count here. The
  // `price_light.*` outcome actions carry no `agent` field at all (they predate agent #2): every
  // one of them is recorded by the /price-light screen and is evidence about the price-light
  // JUDGE's verdicts specifically, so only that agent's maturity may include them - otherwise a
  // second agent with none of its own outcome actions yet (price-advisor) would inherit price
  // light's agree/disagree counts wholesale.
  const relevant = rows.filter((r) => {
    if (r.action === "agent.feedback") return (r.metadata as { agent?: string } | null)?.agent === agentKey;
    return agentKey === "price-light";
  });
  const createdAtOf = new Map(relevant.map((r) => [r as MaturityRow, r.created_at]));

  const cutoff = Date.now() - days * 86_400_000;
  const windowed = relevant.filter((r) => Date.parse(r.created_at) >= cutoff);
  const overall = maturityFrom(windowed);
  const weekly = weeklySeriesFrom(relevant, createdAtOf, WEEKLY_WEEKS);

  return { ...overall, weekly };
}

export { MATURITY_MIN_DECISIONS };
