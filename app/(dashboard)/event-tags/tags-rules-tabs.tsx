"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TagsManager } from "./tags-manager";
import { RulesManager } from "./rules-manager";
import type { EventTag } from "@/types/taxonomy.types";
import type { TagRuleWithTag } from "@/lib/actions/tag-rule-actions";

/**
 * One screen for the whole tagging system: the tag pool and the auto-tag
 * rules, switched by the banner tabs (was two sidebar pages).
 */
export function TagsRulesTabs({
  initialTab,
  tags,
  counts,
  rules,
}: {
  initialTab: "tags" | "rules";
  tags: EventTag[];
  counts: Record<number, number>;
  rules: TagRuleWithTag[];
}) {
  return (
    <Tabs defaultValue={initialTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="tags">תגיות (Tags)</TabsTrigger>
        <TabsTrigger value="rules">כללי תיוג (Rules)</TabsTrigger>
      </TabsList>
      <TabsContent value="tags">
        <TagsManager initial={tags} counts={counts} />
      </TabsContent>
      <TabsContent value="rules">
        <RulesManager initialRules={rules} tags={tags} />
      </TabsContent>
    </Tabs>
  );
}
