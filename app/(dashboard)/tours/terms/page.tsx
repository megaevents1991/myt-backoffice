import { PageHeader } from "@/components/page-header";
import { listTourTerms } from "@/lib/actions/tours-content-actions";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { PageLoadError } from "@/components/tours/content/save-bar";
import { TermsTable } from "@/components/tours/content/terms-table";

export const dynamic = "force-dynamic";

export default async function TourTermsPage() {
  const result = await listTourTerms();
  return (
    <div>
      <PageHeader
        title="Categories & Tags"
        description="The destinations, audiences, tags and other categories the site filters and groups by. Each one has a page on the site with a name, description and hero images."
        actions={<PublishSiteButton />}
      />
      {result.success ? <TermsTable rows={result.data} /> : <PageLoadError message={result.error} />}
    </div>
  );
}
