import { listTags, getTagEventCounts } from "@/lib/actions/event-taxonomy-actions";
import { listTagRules } from "@/lib/actions/tag-rule-actions";
import { TagsRulesTabs } from "./tags-rules-tabs";

export const dynamic = "force-dynamic";

export default async function EventTagsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const [tags, counts, rules] = await Promise.all([
    listTags(),
    getTagEventCounts(),
    listTagRules(),
  ]);
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Tags & Rules (תגיות וכללי תיוג)</h1>
        <p className="text-sm text-muted-foreground">
          תגיות מרכיבות קטגוריות ומזינות את הפיד; כללים מתייגים אירועים
          אוטומטית (הוספה בלבד - לא מוחקים תיוג ידני).
        </p>
      </div>
      <TagsRulesTabs
        initialTab={tab === "rules" ? "rules" : "tags"}
        tags={tags}
        counts={counts}
        rules={rules}
      />
    </div>
  );
}
