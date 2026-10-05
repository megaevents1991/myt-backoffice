import { PageHeader } from "@/components/page-header";
import { listTourCmsPages } from "@/lib/actions/tours-content-actions";
import { AddCmsPageButton, CmsPagesTable } from "@/components/tours/content/cms-pages";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { PageLoadError } from "@/components/tours/content/save-bar";

export const dynamic = "force-dynamic";

export default async function TourCmsPagesPage() {
  const result = await listTourCmsPages();
  return (
    <div>
      <PageHeader
        title="Content Pages"
        description="The free-form pages of the site (about, FAQ, terms, contact, guides) and the blog posts. Add a page or a post, write it, switch it on, and Revalidate Pages."
        actions={
          <>
            <PublishSiteButton />
            <AddCmsPageButton />
          </>
        }
      />
      {result.success ? <CmsPagesTable rows={result.data} /> : <PageLoadError message={result.error} />}
    </div>
  );
}
