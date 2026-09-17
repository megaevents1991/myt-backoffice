// What an MYT agent IS - the shared shape every agent in this repo is declared with.
//
// The price light is the first one (lib/agents/price-light.agent.ts); more will follow for other
// parts of the system (Dor, 2026-09-13: "בהמשך נכין עוד agents שנתאים אותם לכל המערכת"). Everything
// that used to be a constant buried inside the judge - model, ceiling, timeout, confidence floor,
// price per token, kill switch - lives on the definition instead, so a second agent is a file that
// declares those values rather than a second copy of the plumbing.
//
// The part that makes these agents rather than prompts is `houseRules` + `learnsFrom`:
//   - houseRules() is GENERATED from the code the agent's answers feed, never hand-copied, so
//     tuning a rule re-teaches the agent on its next call instead of drifting from a stale prompt.
//   - learnsFrom declares which recorded human decisions the agent reads back as evidence.

/** Registered agents. One key per agent, used by the registry and in logs. */
export const AGENT_KEYS = ["price-light", "price-advisor"] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];

/** One `audit_log` row, reduced to what a lesson can be built from. */
export interface AuditLessonRow {
  action: string;
  entityId: number | null;
  at: string;
  metadata: Record<string, unknown> | null;
}

/**
 * A recorded human decision this agent learns from.
 *
 * `toLesson` returns the single line the model sees, or null to drop the row (a decision with no
 * usable context teaches nothing and still costs tokens on every call). Rows arrive newest first,
 * and sources are read in declaration order - put the most instructive one first, because the
 * character cap bites the tail.
 */
export interface AgentLearningSource {
  action: string;
  toLesson: (row: AuditLessonRow) => string | null;
}

export interface AgentDefinition {
  key: AgentKey;
  /** Staff-facing name, for screens and emails. */
  title: string;
  /** One Hebrew paragraph - what this agent is for, shown on its "זהות" tab. */
  role: string;
  /** What it decides on its own (Hebrew, short phrases) - the "מחליט לבד" list. */
  decides: string[];
  /** What it never does, however confident (Hebrew) - the "אף פעם לא" list. */
  neverDoes: string[];
  /** What stays a human call, whatever the agent answers (Hebrew) - the "נשאר אצל הצוות" list. */
  humanDecides: string[];
  /** Env var that must equal "on" for this agent to run. Fails closed on anything else. */
  switchEnv: string;
  /** Optional env var overriding `defaultModel`. */
  modelEnv?: string;
  defaultModel: string;
  /** Per-call wall clock. Kept short: a hung call is time a run's budget check cannot see. */
  timeoutMs: number;
  /** Hard ceiling on calls in ONE run, shared across everything that run touches. */
  callsPerRun: number;
  /** Below this the agent's answer is treated as "unsure" rather than acted on. */
  confidenceMin: number;
  usdPerMInput: number;
  usdPerMOutput: number;
  /** Ceiling on the assembled memory block, characters - a runaway prompt is a runaway bill. */
  memoryMaxChars: number;
  /** How many recorded decisions to quote, how long each may be, and how far back to look. */
  lessonMax: number;
  lessonChars: number;
  lessonLookbackDays: number;
  learnsFrom: AgentLearningSource[];
  /** Generated from the live constants of whatever this agent's answers feed. */
  houseRules: () => string;
}

/**
 * How well an agent's answers have held up, from the human decisions it learns from.
 *
 * `agreed`/`disagreed` come from outcome actions (a human repriced/removed/marked sold out vs.
 * silenced or overrode away from red); `reviewedOk`/`reviewedBad` come from direct feedback on a
 * specific verdict (`agent.feedback`). `rate` is `agreed / (agreed + disagreed)`, and stays `null`
 * below 10 such decisions - too little evidence to call it a rate rather than noise.
 */
export interface AgentMaturity {
  agreed: number;
  disagreed: number;
  reviewedOk: number;
  reviewedBad: number;
  rate: number | null;
}
