/** A recurring-task rule: the rule is data, the generator is code
 *  (lib/services/task-rules/<domain>.ts). Spec §2. */
import type { TaskBoard, TaskPriority } from "@/types/task.types";

export const RULE_DOMAINS = ["price_light", "price_changes", "creative_gaps", "custom"] as const;
export type RuleDomain = (typeof RULE_DOMAINS)[number];

export const RULE_MODES = ["weekly_digest", "per_item"] as const;
export type RuleMode = (typeof RULE_MODES)[number];

/** Every field is optional - a rule filters only on what it sets. */
export type RuleMatch = {
  /** price_light: "package" | "ticket"; omitted = package. */
  scope?: "package" | "ticket";
  /** price_light: "football" | "music" … (event vertical tag). */
  vertical?: string;
  /** price_light: only gaps at least this many USD. */
  min_gap_usd?: number;
  /** price_light: only events red for at least N weeks (needs events.light_red_since). */
  min_weeks_red?: number;
  /** price_changes: only frozen rows deviating at least this much. */
  min_deviation_usd?: number;
  /** price_changes: ignore log rows older than this. */
  max_age_days?: number;
  /** creative_gaps: which gap kinds count. Empty = all. */
  kinds?: string[];
  /** creative_gaps: 0 = every gap, 1 = severe only. */
  min_severity?: number;
};

export interface TaskRule {
  id: string;
  name: string;
  domain: RuleDomain;
  mode: RuleMode;
  match: RuleMatch;
  assignee_id: string | null;
  priority: TaskPriority;
  due_days: number | null;
  /** 0 = Sunday … 6 = Saturday. */
  dow: number;
  board: TaskBoard;
  /** custom domain only - the rule IS the task. */
  title: string | null;
  description: string | null;
  active: boolean;
  last_run_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskRuleWithNames extends TaskRule {
  assignee_name: string | null;
}
