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
        description="Every carousel of the site's homepage exactly as the site shows it - the cards it picks by itself included. Drag sections into order or hide one; drag any card to any place and it stays there while the site fills the other places by its rule. Hide a card from a row, add one at a place, set a row's length."
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
