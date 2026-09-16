/**
 * The weekly recurring-task run's decision logic (Task 9, spec §2.1) - PURE,
 * no DB access, so it can be unit-tested with synthetic rows
 * (scripts/weekly-task-gen-selftest.ts) instead of against Supabase. All the
 * actual reads/writes live in lib/services/weekly-task-gen.ts, which calls
 * planRule() and then executes what it decides.
 *
 * Controller rulings this file encodes (2026-09-16, override the original brief):
 * 1. A generator throw is handled by the CALLER (weekly-task-gen.ts) before this
 *    file ever runs - candidates() must already have succeeded by the time
 *    planRule() is called, so a throw never touches a task or last_run_at.
 * 2. Per-item tasks use the domain's NATIVE source (price_light/price_review/
 *    creative_gap), never "recurring" - only weekly digests use "recurring".
 * 3. Per-item dedupe is against ANY open task sharing the candidate's
 *    `{kind, table, row_id}` key, regardless of its source - the caller loads
 *    that set once per rule and hands it in as `openItemKeys`.
 * 4. Digest dedupe is by source_ref `{row_id: rule.id, week}` INCLUDING done
 *    tasks from the same week - the caller passes that as `existingDigestThisWeek`.
 * 5. Auto-close only ever targets earlier weeks' still-open digests of this
 *    rule - the caller does the actual close; this file only signals it via
 *    `closeEarlierDigests`.
 */
import type { RuleCandidate } from "@/lib/services/task-rules";
import type { RuleDomain, TaskRule } from "@/types/task-rule.types";
import type { TaskBoard, TaskPriority, TaskSource, TaskSourceRef } from "@/types/task.types";

/** Column-mapped shape ready for a `tasks` insert (Supabase Standard: never spread a whole object). */
export interface TaskInsert {
  title: string;
  description: string | null;
  priority: TaskPriority;
  assignee_id: string | null;
  created_by: null;
  due_date: string | null;
  source: TaskSource;
  source_ref: TaskSourceRef;
  board: TaskBoard;
}

export interface RulePlan {
  create: TaskInsert[];
  existed: number;
  closeEarlierDigests: boolean;
  skippedWhy?: string;
}

/** A per-item rule creates at most this many tasks in one run (final review, I4): a
 *  broad creative rule could otherwise insert hundreds of rows in one go, flood the
 *  assignee and run past the cron budget. The rest are reported as skipped and picked up
 *  by the next run (they are still open candidates, so dedupe lets them through then). */
export const PER_ITEM_MAX_PER_RUN = 25;

/** Per-item tasks carry the domain's own source (ruling #2) - "custom" has no per_item
 *  mode in practice (its generator always returns []), so it is left unmapped. */
const NATIVE_SOURCE: Partial<Record<RuleDomain, TaskSource>> = {
  price_light: "price_light",
  price_changes: "price_review",
  creative_gaps: "creative_gap",
};

/** Pure day-of-week check, split out so the "wrong day" branch is unit-testable on its
 *  own (self-test requirement). 0 = Sunday … 6 = Saturday, matching rule.dow and
 *  Date#getUTCDay(). A manual "run now" (single ruleId) bypasses this in the caller -
 *  it never calls this helper.
 *
 *  `dow` and `now.getUTCDay()` are both UTC weekdays. The cron itself fires DAILY at
 *  06:00 UTC (08:00-09:00 Israel), where UTC and Israel agree on the date, so the
 *  scheduled run never crosses this boundary - each rule is picked up on its own weekday. A manual FULL run (no ruleId) triggered near
 *  Israeli midnight, however, can evaluate the neighbouring UTC day - e.g. 01:00 Israel time
 *  (May-Oct, UTC+3) is still 22:00 UTC the day before. No behaviour change; just naming the
 *  edge so a "why did it skip today" question doesn't start from scratch. */
export function isRuleDueToday(rule: Pick<TaskRule, "dow">, now: Date): boolean {
  return rule.dow === now.getUTCDay();
}

/** today + due_days in UTC, as `YYYY-MM-DD`. null due_days -> null due_date - a rule with
 *  no due_days means "no deadline", not "due today".
 *
 *  "today" is the UTC calendar date of `now`, same convention as isRuleDueToday above - a
 *  due_date computed near Israeli midnight can land a day off from the Israel-local date
 *  for the same reason. No behaviour change. */
export function dueDateUtc(now: Date, dueDays: number | null): string | null {
  if (dueDays == null) return null;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + dueDays);
  return d.toISOString().slice(0, 10);
}

export interface PlanRuleContext {
  /** isoWeek(now) - the digest dedupe/close key and part of its source_ref. */
  week: string;
  /** generatorFor(rule.domain).digestTitle - passed in rather than imported, so this
   *  file stays DB/generator-free and testable with a fake. */
  digestTitle: (count: number) => string;
  /** generatorFor(rule.domain).screenUrl - the digest's source_ref.url. */
  screenUrl: string;
}

/**
 * Decide what a single rule's run should do. Never touches the database - the caller
 * (runOneRule in weekly-task-gen.ts) executes `create`, counts `existed`, and closes
 * earlier digests when `closeEarlierDigests` is true.
 *
 * @param openItemKeys Only meaningful for `mode: "per_item"` - the set of
 *   `${kind}:${table}:${row_id}` keys already covered by an open task of ANY source
 *   (ruling #3). Ignored for `weekly_digest`.
 * @param existingDigestThisWeek Only meaningful for `mode: "weekly_digest"` - whether a
 *   digest (open OR done) already exists for this rule this week (ruling #4). Ignored
 *   for `per_item`.
 */
export function planRule(
  rule: TaskRule,
  candidates: RuleCandidate[],
  openItemKeys: Set<string>,
  existingDigestThisWeek: boolean,
  now: Date,
  ctx: PlanRuleContext,
): RulePlan {
  const dueDate = dueDateUtc(now, rule.due_days);

  if (rule.mode === "weekly_digest") {
    if (existingDigestThisWeek) {
      return { create: [], existed: 1, closeEarlierDigests: false };
    }

    // "custom" has no live source - the rule IS the task, so an empty candidate list
    // (always empty for custom) never means "nothing to do" the way it does for every
    // other domain.
    if (candidates.length === 0 && rule.domain !== "custom") {
      return { create: [], existed: 0, closeEarlierDigests: true, skippedWhy: "no candidates" };
    }

    const title = rule.title || ctx.digestTitle(candidates.length);
    const lines = candidates.slice(0, 10).map((c) => `• ${c.title}`);
    if (candidates.length > 10) lines.push(`ועוד ${candidates.length - 10}`);
    // Only ever falls back for "custom" (candidates always []) - every other domain
    // already returned above when candidates.length === 0.
    const description = lines.length > 0 ? lines.join("\n") : rule.description || null;

    const sourceRef: TaskSourceRef = {
      kind: "rule",
      table: "task_rules",
      row_id: rule.id,
      label: rule.name,
      url: ctx.screenUrl,
      week: ctx.week,
    };

    const task: TaskInsert = {
      title,
      description,
      priority: rule.priority,
      assignee_id: rule.assignee_id,
      created_by: null,
      due_date: dueDate,
      source: "recurring",
      source_ref: sourceRef,
      board: rule.board,
    };
    return { create: [task], existed: 0, closeEarlierDigests: false };
  }

  // mode: "per_item"
  const nativeSource = NATIVE_SOURCE[rule.domain] ?? "recurring";
  const create: TaskInsert[] = [];
  let existed = 0;
  let overCap = 0;
  for (const candidate of candidates) {
    if (openItemKeys.has(candidate.key)) {
      existed++;
      continue;
    }
    if (create.length >= PER_ITEM_MAX_PER_RUN) {
      overCap++;
      continue;
    }
    create.push({
      title: candidate.title,
      description: candidate.description,
      priority: rule.priority,
      assignee_id: rule.assignee_id,
      created_by: null,
      due_date: dueDate,
      source: nativeSource,
      source_ref: candidate.sourceRef,
      board: rule.board,
    });
  }
  return overCap > 0
    ? { create, existed, closeEarlierDigests: false, skippedWhy: `cap: ${overCap} more next run` }
    : { create, existed, closeEarlierDigests: false };
}
