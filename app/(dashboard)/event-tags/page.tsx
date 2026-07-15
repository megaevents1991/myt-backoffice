import { listTags } from "@/lib/actions/event-taxonomy-actions";
import { TagsManager } from "./tags-manager";

export const dynamic = "force-dynamic";

export default async function EventTagsPage() {
  const tags = await listTags();
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Event Tags</h1>
      <p className="text-sm text-muted-foreground">
        Curated flat tags for product-feed targeting and promotions.
      </p>
      <TagsManager initial={tags} />
    </div>
  );
}
