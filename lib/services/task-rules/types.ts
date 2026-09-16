import type { RuleDomain, RuleMatch } from "@/types/task-rule.types";
import type { TaskSourceRef } from "@/types/task.types";

export interface RuleCandidate {
  /** Stable identity for per_item dedupe: "{kind}:{table}:{row_id}". */
  key: string;
  title: string;
  description: string;
  sourceRef: TaskSourceRef;
}

export interface RuleGenerator {
  domain: RuleDomain;
  /** Hebrew label for the digest title and the rules screen. */
  label: string;
  /** Where the digest task links to. */
  screenUrl: string;
  digestTitle(count: number): string;
  /**
   * READ ONLY. A generator never writes a price and never removes an event.
   *
   * Throws when its data cannot be loaded; callers must not read a throw as
   * "no gaps". The weekly cron auto-closes a digest task once its generator
   * returns zero candidates, so a swallowed DB error would silently close an
   * open digest - only a genuinely empty result may return `[]`.
   */
  candidates(match: RuleMatch): Promise<RuleCandidate[]>;
}
