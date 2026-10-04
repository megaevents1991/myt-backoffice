import Link from "next/link";
import { PlusCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { listTourPackages } from "@/lib/actions/tours-content-actions";
import { PackagesTable } from "@/components/tours/content/packages-table";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { PageLoadError } from "@/components/tours/content/save-bar";

// Per request always: the action reads the session and the active company from cookies.
export const dynamic = "force-dynamic";

export default async function TourPackagesPage() {
  const result = await listTourPackages();
  return (
    <div>
      <PageHeader
        title="Tours"
        description="Every organized tour of the site: its page, seasons, dates, prices, flights and hotels. Open a tour to edit it; changes reach the site after you save and click Revalidate Pages."
        actions={
          <>
            <PublishSiteButton />
            <Button asChild>
              <Link href="/tours/packages/new">
                <PlusCircle className="me-2 h-4 w-4" />
                Add Tour
              </Link>
            </Button>
          </>
        }
      />
      {result.success ? (
        <PackagesTable rows={result.data.rows} siteUrl={result.data.siteUrl} />
      ) : (
        <PageLoadError message={result.error} />
      )}
    </div>
  );
}
