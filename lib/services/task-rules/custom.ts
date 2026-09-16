import type { RuleGenerator } from "./types";

/**
 * The "custom" domain has no live source to scan - the rule itself IS the
 * task (TaskRule.title / TaskRule.description, custom domain only). The
 * engine (Task 9) prefers rule.title over digestTitle() whenever it exists,
 * so this is never shown; it returns an empty string rather than inventing
 * wording no one will read.
 */
export const customGenerator: RuleGenerator = {
  domain: "custom",
  label: "מותאם אישית",
  screenUrl: "/tasks",
  digestTitle: () => "",
  async candidates() {
    return [];
  },
};
