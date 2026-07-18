import { listCategories, getCategoryEventCounts } from "@/lib/actions/event-taxonomy-actions";
import { TaxonomyManager } from "./taxonomy-manager";

export const dynamic = "force-dynamic";

export default async function EventTaxonomyPage() {
  const [categories, counts] = await Promise.all([
    listCategories(),
    getCategoryEventCounts(),
  ]);
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Event Categories</h1>
      <p className="text-sm text-muted-foreground">
        Hierarchical taxonomy the main app uses to build category pages. Assign the
        deepest node — parent pages include the event automatically.
      </p>
      <TaxonomyManager initial={categories} counts={counts} />
    </div>
  );
}
