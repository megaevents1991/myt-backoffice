import { PageHeader } from "@/components/page-header";
import { listTourCmsPages } from "@/lib/actions/tours-content-actions";
import { CmsPagesTable } from "@/components/tours/content/cms-pages";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { LoadError } from "@/components/tours/content/save-bar";

export const dynamic = "force-dynamic";

export default async function TourCmsPagesPage() {
  const result = await listTourCmsPages();
  return (
    <div>
      <PageHeader
        title="Content Pages"
        description="The free-form pages of the site: about, FAQ, terms, contact and the blog posts. A page's address is fixed; you edit its title, content and SEO."
        actions={<PublishSiteButton />}
      />
      {result.success ? <CmsPagesTable rows={result.data} /> : <LoadError message={result.error} />}
    </div>
  );
}
