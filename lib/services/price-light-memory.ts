// The price light's view of the agent layer (spec §5, phase 2.1).
//
// Everything real now lives in lib/agents/: `price-light.agent.ts` declares what this agent is
// and which recorded decisions it learns from, `memory.ts` turns those decisions into the block
// that rides on every call, and `switch.ts` owns the key and the kill switches. This file stays
// as the price light's facade so its callers (the nightly, "בדוק עכשיו", the smoke test) keep one
// obvious import, and so the next agent copies a pattern instead of this feature's plumbing.
import { PRICE_LIGHT_AGENT } from "@/lib/agents";
import { loadAgentLessons, loadAgentMemory } from "@/lib/agents/memory";

export { priceLightHouseRules as houseRules } from "@/lib/agents/price-light.agent";

/** The newest staff decisions on /price-light, already formatted as lesson lines. */
export function loadJudgeLessons(): Promise<string[]> {
  return loadAgentLessons(PRICE_LIGHT_AGENT);
}

/** House rules + the freshest decisions, ready for the judge's system prompt. Never throws. */
export function loadJudgeMemory(): Promise<string> {
  return loadAgentMemory(PRICE_LIGHT_AGENT);
}
