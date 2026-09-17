/**
 * Agent-layer selftest - the switches, the budget, and how a recorded decision becomes a lesson.
 * No DB and no API call: every input here is a synthetic `audit_log` row.
 *
 * Run: npx tsx scripts/agents-selftest.ts
 * (tsx rather than plain node: the agent files resolve `@/` paths from tsconfig.)
 */
import assert from "node:assert/strict";
import { AGENT_KEYS, agentFor, PRICE_ADVISOR_AGENT, PRICE_LIGHT_AGENT } from "@/lib/agents";
import { interleave, memoryBlock, TAUGHT_BLOCK_MAX_CHARS } from "@/lib/agents/memory";
import { agentEnabled, agentModel, anthropicKey, callCostUsd, newBudget, takeBudget } from "@/lib/agents/switch";
import type { AuditLessonRow } from "@/lib/agents/types";
import { AI_VERDICT_PARSER, coerceBool, coerceNum } from "@/lib/services/price-light-judge";
import { adviceBlock, type PriceAdviceFact } from "@/lib/services/price-advice";
import { numbersAreFromFacts, wordAdvice } from "@/lib/services/price-advisor";
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

// ---- AGENT #2 (price advisor): registered, declares itself, learns from its own sources -------
assert.deepEqual(AGENT_KEYS, ["price-light", "price-advisor"]);
const advisorDef = agentFor("price-advisor");
assert.equal(advisorDef.key, "price-advisor");
assert.equal(advisorDef.switchEnv, "PRICE_ADVISOR_AI");
assert.equal(advisorDef.modelEnv, "PRICE_ADVISOR_AI_MODEL");
assert.equal(advisorDef.defaultModel, "claude-opus-5");
assert.equal(advisorDef.callsPerRun, 15);
assert.equal(advisorDef.timeoutMs, 12_000);
assert.equal(advisorDef.confidenceMin, 0);
assert.equal(advisorDef.usdPerMInput, PRICE_LIGHT_AGENT.usdPerMInput, "same token prices as the price-light agent");
assert.equal(advisorDef.usdPerMOutput, PRICE_LIGHT_AGENT.usdPerMOutput);
assert.equal(advisorDef.memoryMaxChars, PRICE_LIGHT_AGENT.memoryMaxChars, "same memory caps as the price-light agent");
assert.equal(advisorDef.lessonMax, PRICE_LIGHT_AGENT.lessonMax);
assert.equal(advisorDef.lessonLookbackDays, PRICE_LIGHT_AGENT.lessonLookbackDays);
assert.equal(advisorDef, PRICE_ADVISOR_AGENT, "the registry and the direct export are the same object");

const advisorRules = advisorDef.houseRules();
assert.ok(advisorRules.includes("MARKUP"), "house rules state the only price it may point at");
assert.ok(advisorRules.includes("$150"), "the red/green thresholds reach the prompt");
assert.ok(advisorRules.toLowerCase().includes("never"), "house rules say what it may never suggest");

const advisorLessonFor = (action: string, metadata: Record<string, unknown>): string | null => {
  const source = advisorDef.learnsFrom.find((s) => s.action === action);
  assert.ok(source, `price-advisor: no learning source declared for ${action}`);
  const row: AuditLessonRow = { action, entityId: 717, at: "2026-09-17T10:00:00.000Z", metadata };
  return source.toLesson(row);
};

// price_light.repriced now carries column/before/after (setEventMarkupFromLight) - this agent
// learns the actual CUT a human made, not just that a gap existed.
const repricedWithCut = advisorLessonFor("price_light.repriced", { ...snapshot, column: "event_additional_markup", before: 80, after: 40 });
assert.ok(repricedWithCut?.includes("package red"));
assert.ok(repricedWithCut?.includes("cut event_additional_markup from $80 to $40"));
// a row from before column/before/after existed teaches nothing about the cut itself - dropped.
assert.equal(advisorLessonFor("price_light.repriced", snapshot), null);
assert.equal(advisorLessonFor("price_light.repriced", { scope: "nonsense", light: "red" }), null);

// agent.feedback is shared across agents - only feedback tagged for THIS agent is a lesson here.
const advisorFeedbackOk = advisorLessonFor("agent.feedback", { agent: "price-advisor", summary: "הצעה טובה, קלענו את ההערכה", verdict_ok: true });
assert.ok(advisorFeedbackOk?.includes("RIGHT"));
assert.ok(advisorFeedbackOk?.includes("הצעה טובה"));
// feedback left on the OTHER agent's verdicts must never leak into this agent's lessons
assert.equal(advisorLessonFor("agent.feedback", { agent: "price-light", summary: "משהו אחר", verdict_ok: true }), null);
assert.equal(advisorLessonFor("agent.feedback", { agent: "price-advisor", verdict_ok: true }), null); // no summary = no lesson

// ---- AI Factory: a second agent's maturity must not inherit price-light's outcome actions ------
// price_light.* rows carry no `agent` field at all (they predate agent #2) - only "price-light"
// may count them; a second agent counts only `agent.feedback` tagged for itself. This mirrors the
// filter in lib/services/ai-factory.ts's loadMaturity (not itself pure/DB-free, hence the mirror).
{
  const relevantFor = (agentKey: string, rows: { action: string; metadata: Record<string, unknown> | null }[]) =>
    rows.filter((r) => (r.action === "agent.feedback" ? (r.metadata as { agent?: string } | null)?.agent === agentKey : agentKey === "price-light"));
  const rows = [
    { action: "price_light.repriced", metadata: null },
    { action: "agent.feedback", metadata: { agent: "price-advisor", verdict_ok: true } },
  ];
  assert.equal(relevantFor("price-light", rows).length, 1, "price-light keeps its own repriced row, loses the advisor's feedback");
  assert.equal(relevantFor("price-advisor", rows).length, 1, "price-advisor keeps its own feedback row, never the repriced outcome");
  assert.equal(relevantFor("price-advisor", rows)[0].action, "agent.feedback");
}

// ---- agent #2's own call: numbersAreFromFacts guard (pure, no network) -------------------------
const advisorFacts: PriceAdviceFact[] = [
  { kind: "markup_cut", text: "הורדת מארקאפ החבילה ב-$40 מביאה לכתום (נשאר מארקאפ $60). לירוק צריך $70, יותר מכל המארקאפ.", saves_usd: 40 },
];
assert.equal(numbersAreFromFacts("קיצוץ של $40 יביא לכתום, ואפשר גם $60 שנשאר.", advisorFacts), true, "numbers that reuse the facts are accepted");
assert.equal(numbersAreFromFacts("קיצוץ של $999 יביא לכתום.", advisorFacts), false, "an invented number is rejected");
assert.equal(numbersAreFromFacts("אין כאן שום מספר.", advisorFacts), true, "no dollar figure at all is vacuously fine");

// ---- agent #2's own call: OFF (no switch, no key) never touches the network --------------------
// A named async function + a call at the bottom (not top-level `await`) - this file runs under
// plain `npx tsx`, and esbuild's cjs output (this repo's tsconfig target) rejects top-level await.
async function testWordAdviceOff(): Promise<void> {
  const savedEnv = { ...process.env };
  delete process.env.AI_AGENTS;
  delete process.env.PRICE_ADVISOR_AI;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const budget = newBudget(PRICE_ADVISOR_AGENT);
    const off = await wordAdvice({ eventName: "אירוע בדיקה", scope: "package", facts: advisorFacts, budget, memory: null });
    assert.equal(off.ai, false, "agent off -> the deterministic block, never an AI answer");
    assert.equal(off.text, adviceBlock(advisorFacts));
    assert.equal(off.cost_usd, 0);
    assert.equal(budget.remaining, PRICE_ADVISOR_AGENT.callsPerRun, "an agent that never ran never spent its budget");

    const noFacts = await wordAdvice({ eventName: "אירוע בדיקה", scope: "ticket", facts: [], budget, memory: null });
    assert.equal(noFacts.ai, false);
    assert.equal(noFacts.text, "", "no facts at all -> the empty block, still no network call");
  } finally {
    process.env = savedEnv;
  }
}

testWordAdviceOff()
  .then(() => console.log("agents selftest: all assertions passed"))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
