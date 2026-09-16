// scripts/task-rule-validation-selftest.ts - `npx tsx scripts/task-rule-validation-selftest.ts`
// Pure only: validateRuleInput fed synthetic payloads. No DB, no network.
import { validateRuleInput } from "../lib/tasks/rule-validation";

let failed = 0;
function checkOk(name: string, input: unknown, want: Record<string, unknown>) {
  const result = validateRuleInput(input);
  if (!result.ok) {
    failed++;
    console.error(`FAIL ${name}: expected ok, got error "${result.error}"`);
    return;
  }
  for (const [key, value] of Object.entries(want)) {
    const got = (result.value as unknown as Record<string, unknown>)[key];
    if (JSON.stringify(got) !== JSON.stringify(value)) {
      failed++;
      console.error(`FAIL ${name}.${key}: got ${JSON.stringify(got)} want ${JSON.stringify(value)}`);
      return;
    }
  }
  console.log(`ok   ${name}`);
}
function checkError(name: string, input: unknown, wantSubstring: string) {
  const result = validateRuleInput(input);
  if (result.ok) {
    failed++;
    console.error(`FAIL ${name}: expected error containing "${wantSubstring}", got ok`);
    return;
  }
  if (!result.error.includes(wantSubstring)) {
    failed++;
    console.error(`FAIL ${name}: error "${result.error}" does not contain "${wantSubstring}"`);
    return;
  }
  console.log(`ok   ${name}`);
}

const basePriceLight = {
  name: "רמזור אדום שבועי",
  domain: "price_light",
  mode: "weekly_digest",
  match: { scope: "package", min_gap_usd: 150 },
  assignee_id: "11111111-1111-1111-1111-111111111111",
  priority: "high",
  due_days: 3,
  dow: 0,
  board: "ops",
  title: null,
  description: null,
  active: true,
};

checkOk("valid price_light rule", basePriceLight, {
  name: "רמזור אדום שבועי",
  domain: "price_light",
  match: { scope: "package", min_gap_usd: 150 },
  due_days: 3,
  dow: 0,
  active: true,
});

checkOk("unknown match key dropped", { ...basePriceLight, match: { min_gap_usd: 150, foo: "bar" } }, {
  match: { min_gap_usd: 150 },
});

checkOk("negative match number dropped, rule still ok", { ...basePriceLight, match: { min_gap_usd: -5 } }, {
  match: {},
});

checkOk("invalid scope value dropped", { ...basePriceLight, match: { scope: "vip" } }, { match: {} });

checkOk(
  "kinds filtered to known GAP_KINDS only",
  { ...basePriceLight, domain: "creative_gaps", match: { kinds: ["team_logo", "not_a_kind", 5] } },
  { match: { kinds: ["team_logo"] } },
);

checkOk("due_days null accepted", { ...basePriceLight, due_days: null }, { due_days: null });

checkOk("default active true when omitted", (() => {
  const { active: _active, ...rest } = basePriceLight;
  return rest;
})(), { active: true });

checkOk(
  "custom domain with title ok",
  { ...basePriceLight, domain: "custom", title: "Weekly sweep", description: "check the queue" },
  { domain: "custom", title: "Weekly sweep", description: "check the queue" },
);

checkError("due_days 0 rejected", { ...basePriceLight, due_days: 0 }, "due_days");
checkError("due_days 61 rejected", { ...basePriceLight, due_days: 61 }, "due_days");
checkError("invalid domain rejected", { ...basePriceLight, domain: "not_a_domain" }, "domain");
checkError("invalid mode rejected", { ...basePriceLight, mode: "hourly" }, "mode");
checkError("invalid priority rejected", { ...basePriceLight, priority: "critical" }, "priority");
checkError("invalid board rejected", { ...basePriceLight, board: "sales" }, "board");
checkError("dow out of range rejected", { ...basePriceLight, dow: 7 }, "dow");
checkError("dow non-integer rejected", { ...basePriceLight, dow: 1.5 }, "dow");
checkError("empty name rejected", { ...basePriceLight, name: "   " }, "name");
checkError("name too long rejected", { ...basePriceLight, name: "x".repeat(121) }, "name");
checkError("custom domain without title rejected", { ...basePriceLight, domain: "custom", title: "" }, "title");
checkError("non-object input rejected", "nope", "invalid input");

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
