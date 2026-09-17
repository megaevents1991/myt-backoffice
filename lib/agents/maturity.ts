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
import type { AgentMaturity } from "./types";

/** A human treated the flagged gap as real. */
const AGREE_ACTIONS = new Set(["price_light.repriced", "price_light.removed", "price_light.sold_out"]);

export interface MaturityRow {
  action: string;
  metadata: Record<string, unknown> | null;
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
