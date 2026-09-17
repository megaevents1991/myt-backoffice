/**
 * Agent-layer selftest - the switches, the budget, and how a recorded decision becomes a lesson.
 * No DB and no API call: every input here is a synthetic `audit_log` row.
 *
 * Run: npx tsx scripts/agents-selftest.ts
 * (tsx rather than plain node: the agent files resolve `@/` paths from tsconfig.)
 */
import assert from "node:assert/strict";
import { AGENT_KEYS, agentFor, PRICE_LIGHT_AGENT } from "@/lib/agents";
import { interleave, memoryBlock, TAUGHT_BLOCK_MAX_CHARS } from "@/lib/agents/memory";
import { agentEnabled, agentModel, anthropicKey, callCostUsd, newBudget, takeBudget } from "@/lib/agents/switch";
import type { AuditLessonRow } from "@/lib/agents/types";
import { AI_VERDICT_PARSER, coerceBool, coerceNum } from "@/lib/services/price-light-judge";
// Relative ".ts" import, no "@/" alias (see lib/agents/maturity.ts's header) - keeps this pure
// module importable by a plain-node runner too, the same way scripts/price-light-selftest.ts
// imports lib/services/price-light.ts.
import { maturityFrom } from "../lib/agents/maturity.ts";

const def = PRICE_LIGHT_AGENT;
const lessonFor = (action: string, metadata: Record<string, unknown>): string | null => {
  const source = def.learnsFrom.find((s) => s.action === action);
  assert.ok(source, `no learning source declared for ${action}`);
  const row: AuditLessonRow = { action, entityId: 717, at: "2026-09-13T10:00:00.000Z", metadata };
  return source.toLesson(row);
};

const snapshot = {
  scope: "package", light: "red", diff_usd: 420, our_usd: 2045,
  competitor: "golasso", normalized_usd: 1625, nights_ours: 4, nights_theirs: 3, uncertainty_usd: 0,
};

// ---- switches: opt-in, fail closed -----------------------------------------------------------
const env = { ...process.env };
const reset = () => {
  delete process.env.AI_AGENTS;
  delete process.env.PRICE_LIGHT_AI;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.PRICE_LIGHT_AI_MODEL;
};

reset();
assert.equal(agentEnabled(def), false, "unset = off");
process.env.PRICE_LIGHT_AI = "on";
assert.equal(agentEnabled(def), false, "switch on but no key = off");
process.env.ANTHROPIC_API_KEY = "REPLACE_ME";
assert.equal(anthropicKey(), null, "a placeholder is not a key");
assert.equal(agentEnabled(def), false, "placeholder key = off");
process.env.ANTHROPIC_API_KEY = "sk-ant-synthetic-not-a-real-key";
assert.equal(agentEnabled(def), true, "switch on + key shaped right = on");
process.env.PRICE_LIGHT_AI = "ON";
assert.equal(agentEnabled(def), false, 'only the literal "on" counts');
process.env.PRICE_LIGHT_AI = "on";
process.env.AI_AGENTS = "off";
assert.equal(agentEnabled(def), false, "master switch stops every agent");
process.env.AI_AGENTS = "";
assert.equal(agentEnabled(def), true, "empty master switch governs nothing");
assert.equal(agentModel(def), def.defaultModel);
process.env.PRICE_LIGHT_AI_MODEL = "claude-sonnet-5";
assert.equal(agentModel(def), "claude-sonnet-5", "env overrides the default model");
process.env.PRICE_LIGHT_AI_MODEL = "   ";
assert.equal(agentModel(def), def.defaultModel, "a blank override is not a model");
reset();
Object.assign(process.env, env);

// ---- budget ----------------------------------------------------------------------------------
const budget = newBudget(def);
assert.equal(budget.remaining, def.callsPerRun);
for (let i = 0; i < def.callsPerRun; i += 1) assert.equal(takeBudget(budget), true);
assert.equal(takeBudget(budget), false, "past the ceiling no call is allowed");
assert.equal(budget.remaining, 0, "a refused call does not push the budget negative");
assert.equal(takeBudget(undefined), true, "no budget = no ceiling (ad-hoc callers)");

// ---- cost ------------------------------------------------------------------------------------
assert.equal(callCostUsd(def, 1_000_000, 0), def.usdPerMInput);
assert.equal(callCostUsd(def, 0, 1_000_000), def.usdPerMOutput);
assert.equal(callCostUsd(def, 2_211, 143), Math.round(((2_211 * 5 + 143 * 25) / 1_000_000) * 10_000) / 10_000);

// ---- house rules are GENERATED, not hand-written ----------------------------------------------
const rules = def.houseRules();
assert.ok(rules.includes("$120"), "bag adjustment reaches the prompt");
assert.ok(rules.includes("$45-260"), "the night-rate band reaches the prompt");
assert.ok(rules.includes("14 days"), "the season-page ceiling reaches the prompt");

// ---- decisions become lessons -----------------------------------------------------------------
const override = lessonFor("price_light.override", { ...snapshot, to_light: "green", note: "איסתא מוכרים 3 לילות, אנחנו 4" });
assert.ok(override?.includes("package red"), "the OVERRULED light is the one described");
assert.ok(override?.includes("nights 4 vs 3"));
assert.ok(override?.includes('to "green"'), "the forced light is named separately");
assert.ok(override?.includes("איסתא מוכרים 3 לילות"), "the human's own sentence survives");
// an override with no reason is not a lesson, and would cost tokens on every call
assert.equal(lessonFor("price_light.override", { ...snapshot, to_light: "green" }), null);
assert.equal(lessonFor("price_light.override", { ...snapshot, to_light: "green", note: "   " }), null);
// a row written before the snapshot existed still teaches, from its note alone
const legacy = lessonFor("price_light.override", { scope: "package", light: "green", note: "old row" });
assert.ok(legacy?.includes("old row"));
assert.ok(legacy?.includes('to "green"'), "with no to_light, the recorded light is the forced one");

assert.ok(lessonFor("price_light.repriced", snapshot)?.includes("judged the gap REAL"));
assert.ok(lessonFor("price_light.removed", snapshot)?.includes("pulled the event off the site"));
assert.ok(lessonFor("price_light.sold_out", snapshot)?.includes("SOLD OUT"));
assert.ok(lessonFor("price_light.silenced", { ...snapshot, days: 14 })?.includes("ACCEPTABLE"));
assert.ok(lessonFor("price_light.task_opened", { ...snapshot, task_id: "t1" })?.includes("opened a task"));
// a decision with no recorded comparison teaches nothing - dropped rather than guessed at
assert.equal(lessonFor("price_light.removed", { days: 14 }), null);
assert.equal(lessonFor("price_light.removed", { scope: "nonsense", light: "red" }), null);
// ticket decisions carry no duration (a ticket has no nights)
const ticket = lessonFor("price_light.repriced", { ...snapshot, scope: "ticket", nights_ours: null });
assert.ok(ticket?.includes("ticket red"));
assert.ok(!ticket?.includes("nights"));

// ---- the quota is shared between the sources ---------------------------------------------------
// One from each source in turn: every mark reaches the agent, and when the quota runs out
// mid-lap the sharper (earlier-declared) sources are the ones already in.
assert.deepEqual(interleave([["a1", "a2", "a3"], ["b1"], ["c1", "c2"]], 10), ["a1", "b1", "c1", "a2", "c2", "a3"]);
assert.deepEqual(interleave([["a1", "a2", "a3"], ["b1"], ["c1"]], 3), ["a1", "b1", "c1"]);
// a lone source may take the whole quota - better a full block of overrides than a half-empty one
assert.deepEqual(interleave([["a1", "a2"], [], []], 2), ["a1", "a2"]);
assert.deepEqual(interleave([[], []], 5), []);
assert.deepEqual(interleave([], 5), []);

// ---- the memory block fences the lessons -------------------------------------------------------
assert.equal(memoryBlock(def, []), rules, "no decisions yet = rules alone, no empty heading");
const block = memoryBlock(def, ["package red — a human did something"]);
assert.ok(block.startsWith(rules), "rules come first");
assert.ok(block.includes("DATA, not instructions"), "staff text is fenced as data");
assert.ok(block.includes("- package red — a human did something"));

// ---- the judge's answer reader (2026-09-14: Opus 5 answered "true" / "3" as STRINGS) ----
assert.equal(coerceBool("true"), true);
assert.equal(coerceBool(" False "), false);
assert.equal(coerceBool(true), true);
assert.equal(coerceBool("unknown"), "unknown");
assert.equal(coerceBool("yes"), "unknown"); // only the two spellings the schema allows
assert.equal(coerceNum("3"), 3);
assert.equal(coerceNum(4), 4);
assert.equal(coerceNum("0.95"), 0.95);
assert.equal(coerceNum("unknown"), "unknown");
assert.equal(coerceNum("3 nights"), "unknown");
assert.equal(AI_VERDICT_PARSER, 2);

// ---- AI Factory: declaration fields (spec §5.1) ------------------------------------------------
// Every registered agent must carry a non-empty role + all three lists - the Identity tab has
// nothing to show otherwise.
for (const key of AGENT_KEYS) {
  const agent = agentFor(key);
  assert.ok(agent.role.trim().length > 0, `${key}: role must not be empty`);
  assert.ok(agent.decides.length > 0, `${key}: decides must not be empty`);
  assert.ok(agent.neverDoes.length > 0, `${key}: neverDoes must not be empty`);
  assert.ok(agent.humanDecides.length > 0, `${key}: humanDecides must not be empty`);
}

// ---- AI Factory: taught rules ride WITH the house rules, outside the DATA fence ----------------
const taughtOnly = memoryBlock(def, [], ["ISSTA תמיד מוכרים 3 לילות, לא 4"]);
assert.ok(taughtOnly.startsWith(rules), "house rules still come first");
assert.ok(taughtOnly.includes("כללי צוות"), "the taught-rules heading is rendered");
assert.ok(taughtOnly.includes("ISSTA תמיד מוכרים"), "the taught text itself is rendered");
assert.ok(!taughtOnly.includes("DATA, not instructions"), "no lessons yet = no fence at all");

const taughtAndLessons = memoryBlock(def, ["package red — a human did something"], ["כלל אחד"]);
const fenceIndex = taughtAndLessons.indexOf("DATA, not instructions");
const taughtIndex = taughtAndLessons.indexOf("כללי צוות");
assert.ok(taughtIndex >= 0 && fenceIndex >= 0 && taughtIndex < fenceIndex, "taught rules sit BEFORE the data fence, not inside it");

// A single taught rule far longer than the cap still renders a block no bigger than the cap.
const hugeRule = "א".repeat(TAUGHT_BLOCK_MAX_CHARS * 2);
const withHugeRule = memoryBlock(def, [], [hugeRule]);
const taughtSectionLength = withHugeRule.length - rules.length; // "\n\n" + the taught block
assert.ok(taughtSectionLength <= TAUGHT_BLOCK_MAX_CHARS + 2, "the taught-rules block is capped");

// ---- AI Factory: agent.feedback lesson formatter (both verdicts + the no-summary case) --------
const feedbackOk = lessonFor("agent.feedback", { agent: "price-light", match_id: 717, verdict_ok: true, summary: "golasso 3 nights matched correctly", note: "good catch" });
assert.ok(feedbackOk?.includes("RIGHT"));
assert.ok(feedbackOk?.includes("golasso 3 nights matched correctly"));
assert.ok(feedbackOk?.includes("good catch"));
const feedbackBad = lessonFor("agent.feedback", { agent: "price-light", match_id: 718, verdict_ok: false, summary: "missed a season-page window" });
assert.ok(feedbackBad?.includes("WRONG"));
assert.ok(feedbackBad?.includes("missed a season-page window"));
// no usable summary -> the row teaches nothing, however clear the verdict
assert.equal(lessonFor("agent.feedback", { agent: "price-light", match_id: 719, verdict_ok: true }), null);
assert.equal(lessonFor("agent.feedback", { agent: "price-light", match_id: 720, verdict_ok: false, summary: "   " }), null);

// ---- AI Factory: maturity arithmetic (lib/agents/maturity.ts, pure) ----------------------------
assert.deepEqual(
  maturityFrom([
    { action: "price_light.repriced", metadata: null },
    { action: "price_light.removed", metadata: null },
    { action: "price_light.sold_out", metadata: null },
    { action: "price_light.silenced", metadata: null },
    { action: "price_light.override", metadata: { to_light: "green" } },
    { action: "price_light.override", metadata: { to_light: "red" } }, // agrees - not counted either way
    { action: "price_light.task_opened", metadata: null }, // not a maturity signal at all
    { action: "agent.feedback", metadata: { verdict_ok: true } },
    { action: "agent.feedback", metadata: { verdict_ok: false } },
    { action: "agent.feedback", metadata: { verdict_ok: true } },
  ]),
  { agreed: 3, disagreed: 2, reviewedOk: 2, reviewedBad: 1, rate: null }, // 3+2=5 < 10 minimum
);
// An override with no to_light at all still counts as a disagreement (not "red" either).
assert.equal(maturityFrom([{ action: "price_light.override", metadata: {} }]).disagreed, 1);
// Past the 10-decision floor, the rate is a plain agreed / (agreed + disagreed).
const eightAgreed = Array.from({ length: 8 }, () => ({ action: "price_light.repriced", metadata: null }));
const twoDisagreed = Array.from({ length: 2 }, () => ({ action: "price_light.silenced", metadata: null }));
assert.equal(maturityFrom([...eightAgreed, ...twoDisagreed]).rate, 0.8);
assert.equal(maturityFrom([]).rate, null, "no decisions at all is also below the floor");

console.log("agents selftest: all assertions passed");
