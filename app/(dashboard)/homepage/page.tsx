import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { RevalidateButton } from "@/components/templates/RevalidateButton";
import { getHomepageLayout } from "@/lib/actions/homepage-actions";
import { PUBLIC_SITE_URL } from "@/lib/site";
import { HomepageBoard } from "./homepage-board";

export const dynamic = "force-dynamic";

export default async function HomepagePage() {
  const layout = await getHomepageLayout();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Homepage"
        description="A dummy of the customer site's homepage. Drag sections into order, hide one, and pin the items that open each carousel - the hero ring, the most-wanted and newest rows, the football and artist rows. Whatever is not pinned follows each section's automatic rule after the pinned items."
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={PUBLIC_SITE_URL} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Open live site
              </a>
            </Button>
            <RevalidateButton />
          </>
        }
      />
      <HomepageBoard initial={layout} />
    </div>
  );
}
