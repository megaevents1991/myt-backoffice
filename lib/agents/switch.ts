// Whether an agent may run at all, and what it costs when it does.
//
// Every agent is OPT-IN and fails CLOSED: unset, empty, or anything but the literal "on" means
// off. That direction is deliberate - the money side must never be able to turn itself on by
// accident (someone clearing a variable to "disable" it, a typo in a deploy script, a placeholder
// that looks like a key). Off costs nothing and degrades to whatever the agent's caller does
// without it, which for the price light is rule-only matching.
import type { AgentDefinition } from "./types";

/** Every Anthropic console key starts with this. A placeholder never does. */
const KEY_PREFIX = "sk-ant-";
/** One switch that stops EVERY agent at once, whatever their own switches say. */
export const AGENTS_MASTER_SWITCH_ENV = "AI_AGENTS";

const warned = new Set<string>();

/**
 * Our key, or null when what is configured is not one.
 *
 * The shape check is what keeps an empty Vercel slot (or a half-pasted value) from being treated
 * as a credential: without it, `ANTHROPIC_API_KEY=REPLACE_ME` plus a switch set to "on" looks
 * enabled and turns every call into a 401 that reads as an ordinary "unsure" with no hint why.
 */
export function anthropicKey(): string | null {
  const raw = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  return raw.startsWith(KEY_PREFIX) ? raw : null;
}

/** The master switch, which only ever turns things OFF. Unset = agents are governed individually. */
export function agentsMasterSwitchOff(): boolean {
  return (process.env[AGENTS_MASTER_SWITCH_ENV] ?? "").trim().toLowerCase() === "off";
}

/**
 * True only when the master switch is not off, this agent's own switch is literally "on", AND a
 * usable key is present. When a switch is on but the key is not usable, say so ONCE per process
 * per agent: silently doing nothing is the confusing outcome, and it is the failure mode of every
 * first-time setup.
 */
export function agentEnabled(def: AgentDefinition): boolean {
  if (agentsMasterSwitchOff()) return false;
  if ((process.env[def.switchEnv] ?? "") !== "on") return false;
  if (anthropicKey()) return true;
  if (!warned.has(def.key)) {
    warned.add(def.key);
    const raw = (process.env.ANTHROPIC_API_KEY ?? "").trim();
    console.warn(
      `agents: ${def.switchEnv}=on but ANTHROPIC_API_KEY is ${raw ? `not a console key (expected it to start with "${KEY_PREFIX}")` : "empty"} - ${def.title} stays off.`,
    );
  }
  return false;
}

export function agentModel(def: AgentDefinition): string {
  const override = def.modelEnv ? process.env[def.modelEnv] : undefined;
  return (override && override.trim()) || def.defaultModel;
}

/** USD for one call, rounded to a hundredth of a cent - stored per call so a month can be summed. */
export function callCostUsd(def: AgentDefinition, inputTokens: number, outputTokens: number): number {
  const usd = (inputTokens * def.usdPerMInput + outputTokens * def.usdPerMOutput) / 1_000_000;
  return Math.round(usd * 10_000) / 10_000;
}

/** Run-wide ceiling on calls, shared (and mutated) across everything one run touches. */
export interface AgentBudget { remaining: number }

export function newBudget(def: AgentDefinition): AgentBudget {
  return { remaining: def.callsPerRun };
}

/** Decrement first, and once the budget is spent report "no call allowed" - callers treat that
 *  exactly as they treat a disabled agent: carry on without it, spend nothing. */
export function takeBudget(budget: AgentBudget | undefined): boolean {
  if (!budget) return true;
  if (budget.remaining <= 0) return false;
  budget.remaining -= 1;
  return true;
}
