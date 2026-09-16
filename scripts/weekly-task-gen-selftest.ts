// scripts/weekly-task-gen-selftest.ts - `npx tsx scripts/weekly-task-gen-selftest.ts`
// Pure only: planRule() + isRuleDueToday()/dueDateUtc(), fed synthetic rules and
// candidates. No DB, no generators - lib/services/weekly-task-gen.ts (the impure
// caller) is exercised separately by the read-only prod dry run in the task report.
import { dueDateUtc, isRuleDueToday, planRule } from "../lib/services/weekly-task-plan";
import type { RuleCandidate } from "../lib/services/task-rules";
import type { TaskRule } from "../types/task-rule.types";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failed++;
    console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

const NOW = new Date("2026-09-16T06:00:00Z"); // Wednesday, ISO week 2026-W38

function rule(overrides: Partial<TaskRule> = {}): TaskRule {
  return {
    id: "rule-1",
    name: "רמזור שבועי",
    domain: "price_light",
    mode: "weekly_digest",
    match: {},
    assignee_id: null,
    priority: "medium",
    due_days: null,
    dow: 3,
    board: "ops",
    title: null,
    description: null,
    active: true,
    last_run_at: null,
    created_by: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...overrides,
  };
}

function candidate(overrides: Partial<RuleCandidate> = {}): RuleCandidate {
  return {
    key: "package:events:1",
    title: "רמזור אדום: מנצ'סטר יונייטד",
    description: "פער $300",
    sourceRef: { kind: "package", table: "events", row_id: 1, label: "מנצ'סטר יונייטד", url: "/events/1#fix-price" },
    ...overrides,
  };
}

const ctx = {
  week: "2026-W38",
  digestTitle: (count: number) => `סקירת רמזור שבועית — ${count} אדומים`,
  screenUrl: "/price-light?f=pending",
};

// --- day-of-week helper -----------------------------------------------------
check("due today", isRuleDueToday(rule({ dow: 3 }), NOW), true);
check("wrong dow is skipped", isRuleDueToday(rule({ dow: 4 }), NOW), false);

// --- due date helper ---------------------------------------------------------
check("due_date = today + due_days (UTC)", dueDateUtc(NOW, 5), "2026-09-21");
check("due_date null when due_days null", dueDateUtc(NOW, null), null);

// --- weekly_digest: created --------------------------------------------------
{
  const plan = planRule(rule(), [candidate(), candidate({ key: "package:events:2", title: "B" })], new Set(), false, NOW, ctx);
  check("digest created: one task", plan.create.length, 1);
  check("digest created: title", plan.create[0]?.title, "סקירת רמזור שבועית — 2 אדומים");
  check("digest created: source", plan.create[0]?.source, "recurring");
  check("digest created: source_ref week", plan.create[0]?.source_ref.week, "2026-W38");
  check("digest created: source_ref row_id is the rule", plan.create[0]?.source_ref.row_id, "rule-1");
  check("digest created: description has both lines", plan.create[0]?.description, "• רמזור אדום: מנצ'סטר יונייטד\n• B");
  check("digest created: no close", plan.closeEarlierDigests, false);
  check("digest created: existed 0", plan.existed, 0);
}

// --- weekly_digest: skipped because one exists this week ---------------------
{
  const plan = planRule(rule(), [candidate()], new Set(), true, NOW, ctx);
  check("digest skipped when one exists this week: no create", plan.create.length, 0);
  check("digest skipped when one exists this week: existed 1", plan.existed, 1);
  check("digest skipped when one exists this week: no close", plan.closeEarlierDigests, false);
}

// --- weekly_digest: zero candidates -> no task, close earlier digests --------
{
  const plan = planRule(rule(), [], new Set(), false, NOW, ctx);
  check("zero candidates: no create", plan.create.length, 0);
  check("zero candidates: closeEarlierDigests true", plan.closeEarlierDigests, true);
  check("zero candidates: skippedWhy", plan.skippedWhy, "no candidates");
}

// --- weekly_digest: custom domain uses rule.title even with zero candidates --
{
  const customRule = rule({ domain: "custom", title: "בדיקת ציוד חודשית", description: "לבדוק את המצלמות" });
  const plan = planRule(customRule, [], new Set(), false, NOW, ctx);
  check("custom rule creates (no close)", plan.create.length, 1);
  check("custom rule uses rule.title", plan.create[0]?.title, "בדיקת ציוד חודשית");
  check("custom rule falls back to rule.description", plan.create[0]?.description, "לבדוק את המצלמות");
  check("custom rule never closes on empty candidates", plan.closeEarlierDigests, false);
}

// --- per_item: native source + candidate sourceRef ---------------------------
{
  const priceChangesRule = rule({ domain: "price_changes", mode: "per_item" });
  const c = candidate({ key: "price_review:events:9", sourceRef: { kind: "price_review", table: "events", row_id: 9, label: "אירוע", url: "/events/9#fix-price" } });
  const plan = planRule(priceChangesRule, [c], new Set(), false, NOW, ctx);
  check("per_item: one create", plan.create.length, 1);
  check("per_item: native source", plan.create[0]?.source, "price_review");
  check("per_item: sourceRef unchanged", plan.create[0]?.source_ref, c.sourceRef);
}

// --- per_item: dedupe against an already-open key -----------------------------
{
  const gapsRule = rule({ domain: "creative_gaps", mode: "per_item" });
  const open = candidate({ key: "team_logo:football_teams:5" });
  const fresh = candidate({ key: "team_logo:football_teams:6", title: "C" });
  const plan = planRule(gapsRule, [open, fresh], new Set(["team_logo:football_teams:5"]), false, NOW, ctx);
  check("per_item dedupe: skips the open key", plan.create.length, 1);
  check("per_item dedupe: keeps the fresh one", plan.create[0]?.title, "C");
  check("per_item dedupe: existed counts the skip", plan.existed, 1);
  check("per_item dedupe: native source for creative_gaps", plan.create[0]?.source, "creative_gap");
}

// --- per_item: due_date threads through per-candidate tasks -------------------
{
  const priceLightPerItem = rule({ domain: "price_light", mode: "per_item", due_days: 3 });
  const plan = planRule(priceLightPerItem, [candidate()], new Set(), false, NOW, ctx);
  check("per_item due_date = today + due_days", plan.create[0]?.due_date, "2026-09-19");
}
{
  const priceLightPerItem = rule({ domain: "price_light", mode: "per_item", due_days: null });
  const plan = planRule(priceLightPerItem, [candidate()], new Set(), false, NOW, ctx);
  check("per_item due_date null when due_days null", plan.create[0]?.due_date, null);
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
