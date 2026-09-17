// The agent registry - the one list of every agent in this system.
//
// Adding an agent is: write `<name>.agent.ts` declaring what it is and what it learns from,
// register it here, give it an env switch. The plumbing (enable/disable, key handling, run
// budget, cost, memory) is already written and is shared.
import { PRICE_LIGHT_AGENT } from "./price-light.agent";
import type { AgentDefinition, AgentKey } from "./types";

export const AGENTS: Record<AgentKey, AgentDefinition> = {
  "price-light": PRICE_LIGHT_AGENT,
};

export function agentFor(key: AgentKey): AgentDefinition {
  const def = AGENTS[key];
  if (!def) throw new Error(`agents: no agent registered for "${key}"`);
  return def;
}

export { PRICE_LIGHT_AGENT };
export { loadActiveTaughtRules, loadAgentLessons, loadAgentMemory, memoryBlock, TAUGHT_BLOCK_MAX_CHARS, TAUGHT_RULES_MAX } from "./memory";
export { maturityFrom, MATURITY_MIN_DECISIONS, type MaturityRow } from "./maturity";
export {
  AGENTS_MASTER_SWITCH_ENV, agentEnabled, agentModel, agentsMasterSwitchOff, anthropicKey,
  callCostUsd, newBudget, takeBudget, type AgentBudget,
} from "./switch";
export {
  AGENT_KEYS, type AgentDefinition, type AgentKey, type AgentLearningSource, type AgentMaturity,
  type AuditLessonRow,
} from "./types";
