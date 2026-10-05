import { PageHeader } from "@/components/page-header";
import { listTourTerms } from "@/lib/actions/tours-content-actions";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { PageLoadError } from "@/components/tours/content/save-bar";
import { AddTermButton, TermsTable } from "@/components/tours/content/terms-table";

export const dynamic = "force-dynamic";

export default async function TourTermsPage() {
  const result = await listTourTerms();
  return (
    <div>
      <PageHeader
        title="Categories & Tags"
        description="The destinations, worlds, tags and categories of the site. Each one has a page that fills itself with the tours that carry it; a world also has its own color and sub-categories."
        actions={
          <>
            <PublishSiteButton />
            {result.success && <AddTermButton />}
          </>
        }
      />
      {result.success ? <TermsTable rows={result.data} /> : <PageLoadError message={result.error} />}
    </div>
  );
}
