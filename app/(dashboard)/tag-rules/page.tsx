import { listTagRules } from "@/lib/actions/tag-rule-actions";
import { listTags } from "@/lib/actions/event-taxonomy-actions";
import { RulesManager } from "./rules-manager";

export const dynamic = "force-dynamic";

export default async function TagRulesPage() {
  const [rules, tags] = await Promise.all([listTagRules(), listTags()]);
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Tag Rules (כללי תיוג)</h1>
        <p className="text-sm text-muted-foreground">
          כלל = דפוס טקסט → תגית. רץ אוטומטית על אירוע חדש; אפשר להריץ ידנית על
          הכל. הוספה בלבד - הכללים אף פעם לא מסירים תגיות.
        </p>
      </div>
      <RulesManager initialRules={rules} tags={tags} />
    </div>
  );
}
