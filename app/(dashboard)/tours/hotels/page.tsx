import { PageHeader } from "@/components/page-header";
import { listTourHotels } from "@/lib/actions/tours-content-actions";
import { HotelsTable } from "@/components/tours/content/hotels";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { LoadError } from "@/components/tours/content/save-bar";

export const dynamic = "force-dynamic";

export default async function TourHotelsPage() {
  const result = await listTourHotels();
  return (
    <div>
      <PageHeader
        title="Hotels"
        description="The hotels the vacation packages offer. A departure's hotel option points to a hotel by its code, and the site takes the name, images and description from here."
        actions={<PublishSiteButton />}
      />
      {result.success ? (
        <HotelsTable rows={result.data.rows} siteUrl={result.data.siteUrl} />
      ) : (
        <LoadError message={result.error} />
      )}
    </div>
  );
}
