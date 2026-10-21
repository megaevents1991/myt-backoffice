// Pure arithmetic for "how well has this agent's help held up" - no DB, no import alias, so
// scripts/agents-selftest.ts (and any plain-node runner, matching scripts/price-light-selftest.ts's
// style) can import it with a relative path and get the same answer every time.
//
// The rows are `audit_log` decisions the agent's OWN screen produced (see
// lib/agents/price-light.agent.ts's `learnsFrom` for what each action means):
//   - agreed: a human acted as if the flagged thing was real (repriced / removed / sold out).
//   - disagreed: a human decided the agent's alarm was wrong (silenced it, or overrode the light
//     to something other than red).
//   - reviewedOk / reviewedBad: direct thumbs up/down on one verdict (`agent.feedback`).
//   - the tour uploader (agent #3) is judged on what staff do with the events it built:
//     `uploader.approved` with `metadata.edited === false` agrees (approved exactly as built);
//     `uploader.rejected`, and `uploader.approved` with `edited === true`, disagree.
import type { AgentKey, AgentMaturity } from "./types";

/** A human treated the flagged gap as real. */
const AGREE_ACTIONS = new Set(["price_light.repriced", "price_light.removed", "price_light.sold_out"]);

export interface MaturityRow {
  action: string;
  metadata: Record<string, unknown> | null;
}

/**
 * Whose maturity a recorded decision counts toward. `agent.feedback` is shared across agents, so
 * only the one it is tagged for owns it. An `uploader.*` action belongs to the tour uploader alone.
 * Every other outcome action is the price-light screen's (`price_light.*` rows predate agent #2 and
 * carry no `agent` tag) - so a second agent never inherits the price light's agree/disagree counts.
 */
export function rowBelongsToAgent(agentKey: AgentKey, row: MaturityRow): boolean {
  if (row.action === "agent.feedback") return row.metadata?.agent === agentKey;
  if (row.action.startsWith("uploader.")) return agentKey === "tour-uploader";
  return agentKey === "price-light";
}

/** Below this many agreed+disagreed decisions, a rate is noise, not a maturity signal. */
export const MATURITY_MIN_DECISIONS = 10;

export function maturityFrom(rows: MaturityRow[]): AgentMaturity {
  let agreed = 0;
  let disagreed = 0;
  let reviewedOk = 0;
  let reviewedBad = 0;

  for (const row of rows) {
    if (AGREE_ACTIONS.has(row.action)) {
      agreed += 1;
      continue;
    }
    if (row.action === "price_light.silenced") {
      disagreed += 1;
      continue;
    }
    if (row.action === "price_light.override") {
      // The forced light IS the disagreement - overriding TO red agrees with the alarm; anything
      // else (including a row with no to_light at all) is a human saying the agent was wrong.
      if (row.metadata?.to_light !== "red") disagreed += 1;
      continue;
    }
    if (row.action === "price_light.corrected") {
      // A field fixed in the detailed comparison. Only a value the AGENT produced (or a match it
      // made) is a review of the agent - a crawler's misread says nothing about it either way.
      if (row.metadata?.source === "ai") reviewedBad += 1;
      continue;
    }
    if (row.action === "uploader.approved") {
      // Approved as built = the agent's plan produced what staff wanted. Edited first = not. A row
      // with no `edited` flag says nothing either way.
      if (row.metadata?.edited === false) agreed += 1;
      else if (row.metadata?.edited === true) disagreed += 1;
      continue;
    }
    if (row.action === "uploader.rejected") {
      disagreed += 1;
      continue;
    }
    if (row.action === "agent.feedback") {
      if (row.metadata?.verdict_ok === true) reviewedOk += 1;
      else if (row.metadata?.verdict_ok === false) reviewedBad += 1;
      continue;
    }
  }

  const denom = agreed + disagreed;
  const rate = denom < MATURITY_MIN_DECISIONS ? null : agreed / denom;
  return { agreed, disagreed, reviewedOk, reviewedBad, rate };
}
