/**
 * Pure validator for a task-rule create/update payload (Task 10, controller ruling #2).
 * No DB, no Supabase - runs under plain `node`/`npx tsx` via
 * scripts/task-rule-validation-selftest.ts.
 *
 * `match` (RuleMatch) is "every field is optional - a rule filters only on what it
 * sets" by its own doc comment, so an unknown key or an out-of-range value there is
 * dropped silently rather than failing the whole rule - it is not a user error, it is
 * just not saved. Only the fields that make a rule actually RUNNABLE (name, domain,
 * mode, priority, board, dow, due_days, and a custom rule's title) fail validation.
 */
import { RULE_DOMAINS, RULE_MODES, type RuleDomain, type RuleMatch, type RuleMode } from "@/types/task-rule.types";
import { TASK_BOARDS, TASK_PRIORITIES, type TaskBoard, type TaskPriority } from "@/types/task.types";
import { GAP_KINDS } from "@/types/creative-gap.types";

export interface TaskRuleInput {
  name: string;
  domain: RuleDomain;
  mode: RuleMode;
  match: RuleMatch;
  assignee_id: string | null;
  priority: TaskPriority;
  due_days: number | null;
  /** 0 = Sunday … 6 = Saturday, UTC (the cron runs Sunday 09:00 Israel time). */
  dow: number;
  board: TaskBoard;
  /** custom domain only. */
  title: string | null;
  description: string | null;
  active: boolean;
}

export type ValidationResult =
  | { ok: true; value: TaskRuleInput }
  | { ok: false; error: string };

const NAME_MAX = 120;
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;
const DUE_DAYS_MIN = 1;
const DUE_DAYS_MAX = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Keeps only the known `RuleMatch` keys, and only where the value is the right
 *  shape - everything else (unknown key, wrong type, out-of-range number) is
 *  dropped rather than rejected. */
function cleanMatch(raw: unknown): RuleMatch {
  if (!isRecord(raw)) return {};
  const match: RuleMatch = {};

  if (raw.scope === "package" || raw.scope === "ticket") match.scope = raw.scope;
  if (typeof raw.vertical === "string" && raw.vertical.trim()) match.vertical = raw.vertical.trim();
  if (isFiniteNonNegative(raw.min_gap_usd)) match.min_gap_usd = raw.min_gap_usd;
  if (isFiniteNonNegative(raw.min_weeks_red)) match.min_weeks_red = raw.min_weeks_red;
  if (isFiniteNonNegative(raw.min_deviation_usd)) match.min_deviation_usd = raw.min_deviation_usd;
  if (isFiniteNonNegative(raw.max_age_days)) match.max_age_days = raw.max_age_days;
  if (isFiniteNonNegative(raw.min_severity)) match.min_severity = raw.min_severity;

  if (Array.isArray(raw.kinds)) {
    const kinds = raw.kinds.filter(
      (kind): kind is string => typeof kind === "string" && (GAP_KINDS as readonly string[]).includes(kind),
    );
    if (kinds.length) match.kinds = kinds;
  }

  return match;
}

export function validateRuleInput(input: unknown): ValidationResult {
  if (!isRecord(input)) return { ok: false, error: "invalid input" };

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return { ok: false, error: "name is required" };
  if (name.length > NAME_MAX) return { ok: false, error: `name must be ${NAME_MAX} characters or fewer` };

  if (typeof input.domain !== "string" || !(RULE_DOMAINS as readonly string[]).includes(input.domain)) {
    return { ok: false, error: "invalid domain" };
  }
  const domain = input.domain as RuleDomain;

  if (typeof input.mode !== "string" || !(RULE_MODES as readonly string[]).includes(input.mode)) {
    return { ok: false, error: "invalid mode" };
  }
  const mode = input.mode as RuleMode;

  if (typeof input.priority !== "string" || !(TASK_PRIORITIES as readonly string[]).includes(input.priority)) {
    return { ok: false, error: "invalid priority" };
  }
  const priority = input.priority as TaskPriority;

  if (typeof input.board !== "string" || !(TASK_BOARDS as readonly string[]).includes(input.board)) {
    return { ok: false, error: "invalid board" };
  }
  const board = input.board as TaskBoard;

  if (typeof input.dow !== "number" || !Number.isInteger(input.dow) || input.dow < 0 || input.dow > 6) {
    return { ok: false, error: "dow must be an integer 0-6" };
  }
  const dow = input.dow;

  let due_days: number | null = null;
  if (input.due_days !== null && input.due_days !== undefined && input.due_days !== "") {
    const n = typeof input.due_days === "number" ? input.due_days : Number(input.due_days);
    if (!Number.isInteger(n) || n < DUE_DAYS_MIN || n > DUE_DAYS_MAX) {
      return { ok: false, error: `due_days must be null or an integer ${DUE_DAYS_MIN}-${DUE_DAYS_MAX}` };
    }
    due_days = n;
  }

  const assignee_id =
    typeof input.assignee_id === "string" && input.assignee_id.trim() ? input.assignee_id.trim() : null;

  let title: string | null = null;
  let description: string | null = null;
  if (domain === "custom") {
    const rawTitle = typeof input.title === "string" ? input.title.trim() : "";
    if (!rawTitle) return { ok: false, error: "custom rules need a title" };
    if (rawTitle.length > TITLE_MAX) return { ok: false, error: `title must be ${TITLE_MAX} characters or fewer` };
    title = rawTitle;
    description =
      typeof input.description === "string" && input.description.trim()
        ? input.description.trim().slice(0, DESCRIPTION_MAX)
        : null;
  }

  const active = input.active !== false;
  const match = cleanMatch(input.match);

  return {
    ok: true,
    value: { name, domain, mode, match, assignee_id, priority, due_days, dow, board, title, description, active },
  };
}
