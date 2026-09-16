import type { RuleDomain } from "@/types/task-rule.types";
import type { RuleGenerator } from "./types";
import { priceLightGenerator } from "./price-light";
import { priceChangesGenerator } from "./price-changes";
import { creativeGapsGenerator } from "./creative-gaps";
import { customGenerator } from "./custom";

const GENERATORS: Record<RuleDomain, RuleGenerator> = {
  price_light: priceLightGenerator,
  price_changes: priceChangesGenerator,
  creative_gaps: creativeGapsGenerator,
  custom: customGenerator,
};

export function generatorFor(domain: RuleDomain): RuleGenerator {
  return GENERATORS[domain];
}

export type { RuleCandidate, RuleGenerator } from "./types";
