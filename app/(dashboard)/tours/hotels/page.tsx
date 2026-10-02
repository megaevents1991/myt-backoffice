import { PageHeader } from "@/components/page-header";
import { listTourHotels } from "@/lib/actions/tours-content-actions";
import { AddHotelButton, HotelsTable } from "@/components/tours/content/hotels";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { PageLoadError } from "@/components/tours/content/save-bar";

export const dynamic = "force-dynamic";

export default async function TourHotelsPage() {
  const result = await listTourHotels();
  return (
    <div>
      <PageHeader
        title="Hotels"
        description="The hotels the vacation packages offer. A departure's hotel option points to a hotel by its code, and the site takes the name, images and description from here."
        actions={
          <>
            <PublishSiteButton />
            {result.success && <AddHotelButton />}
          </>
        }
      />
      {result.success ? (
        <HotelsTable rows={result.data.rows} siteUrl={result.data.siteUrl} />
      ) : (
        <PageLoadError message={result.error} />
      )}
    </div>
  );
}
