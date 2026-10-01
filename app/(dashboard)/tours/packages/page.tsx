import { PageHeader } from "@/components/page-header";
import { listTourPackages } from "@/lib/actions/tours-content-actions";
import { PackagesTable } from "@/components/tours/content/packages-table";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { LoadError } from "@/components/tours/content/save-bar";

// Per request always: the action reads the session and the active company from cookies.
export const dynamic = "force-dynamic";

export default async function TourPackagesPage() {
  const result = await listTourPackages();
  return (
    <div>
      <PageHeader
        title="Tour Pages"
        description="Each page here is a product page on the site: name, images, description, itinerary and FAQ. Series and departures are sold on the page. Changes reach the site after you save and publish."
        actions={<PublishSiteButton />}
      />
      {result.success ? (
        <PackagesTable rows={result.data.rows} siteUrl={result.data.siteUrl} />
      ) : (
        <LoadError message={result.error} />
      )}
    </div>
  );
}
