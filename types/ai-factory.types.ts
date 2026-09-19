// Types for the AI Factory admin area (spec docs/superpowers/specs/2026-09-16-price-light-gaps-ai-factory-design.md
// §5, §8) - reads live in lib/services/ai-factory.ts, mutations in lib/actions/ai-factory-actions.ts.
import type { AgentKey, AgentMaturity } from "@/lib/agents";
import type { LessonTrace } from "@/lib/agents/types";

/**
 * Why an agent is or isn't running right now, one level more specific than the plain boolean
 * `agentEnabled()` - the AI Factory overview needs to SAY which of the three gates is closed.
 */
export type AgentSwitchState = "on" | "off" | "key_missing" | "master_off";

/** One card on `/ai-factory`. */
export interface AgentOverviewRow {
  key: AgentKey;
  title: string;
  switchState: AgentSwitchState;
  model: string;
  costUsdThisMonth: number;
  callsThisMonth: number;
  /** null = fewer than MATURITY_MIN_DECISIONS agreed+disagreed decisions - "אין מספיק החלטות". */
  maturityRate: number | null;
}

/** The numbers on the "זהות" tab's settings table + "איך מדליקים" - read-only, never editable here. */
export interface AgentSettings {
  model: string;
  callsPerRun: number;
  confidenceMin: number;
  timeoutMs: number;
  usdPerMInput: number;
  usdPerMOutput: number;
  memoryMaxChars: number;
  lessonMax: number;
  lessonLookbackDays: number;
  /** Env var names, not values - "איך מדליקים" only ever shows names. */
  switchEnv: string;
  modelEnv: string | null;
  keyEnv: string;
  masterSwitchEnv: string;
}

/** One row of `agent_instructions`, active or not - the "זיכרון ולימוד" tab's taught-rules list. */
export interface TaughtRule {
  id: string;
  text: string;
  active: boolean;
  createdBy: string | null;
  createdAt: string;
  deactivatedAt: string | null;
}

/** Everything `/ai-factory/[key]` needs to render its four tabs. */
export interface AgentDetail {
  key: AgentKey;
  title: string;
  role: string;
  decides: string[];
  neverDoes: string[];
  humanDecides: string[];
  switchState: AgentSwitchState;
  settings: AgentSettings;
  /** Generated from the live engine constants - never hand-copied (lib/agents `houseRules()`). */
  houseRules: string;
  /** The recorded decisions, already formatted exactly as the real prompt receives them. */
  lessons: string[];
  /** Every mark staff left in the lookback window and what became of it - quoted in the prompt,
   *  waiting for a slot, or dropped (and why). The answer to "what does it learn, and from where". */
  trace: LessonTrace[];
  /** The whole memory block exactly as the model reads it on its next call (rules + taught rules
   *  + quoted lessons, capped at `memoryMaxChars`). */
  promptPreview: string;
  taughtRules: TaughtRule[];
}

/** One AI call the price-light judge made, as the "יומן" tab's table shows it. */
export interface AgentLogRow {
  id: number;
  eventId: number;
  eventName: string | null;
  competitor: string;
  scope: string;
  status: string;
  createdAt: string;
  verdict: {
    sameEvent: boolean | "unknown" | null;
    confidence: number | null;
    note: string | null;
    error: string | null;
    cached: boolean | null;
    costUsd: number | null;
    model: string | null;
  };
  /** The newest staff feedback recorded on THIS match, if any. */
  feedback: { verdictOk: boolean; note: string | null; at: string } | null;
}

export interface AgentLogPage {
  rows: AgentLogRow[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** One point on the "בשלות" tab's weekly bar chart. */
export interface MaturityWeekPoint {
  weekStart: string; // YYYY-MM-DD
  agreed: number;
  disagreed: number;
}

export interface AgentMaturityDetail extends AgentMaturity {
  weekly: MaturityWeekPoint[];
}
