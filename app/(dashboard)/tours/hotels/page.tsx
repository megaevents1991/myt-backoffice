import { PageHeader } from "@/components/page-header";
import { listTourHotels } from "@/lib/actions/tours-content-actions";
import { HotelsTable } from "@/components/tours/content/hotels";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { LoadError } from "@/components/tours/content/save-bar";

export const dynamic = "force-dynamic";

export default async function TourHotelsPage() {
  const result = await listTourHotels();
  return (
    <div dir="rtl">
      <PageHeader
        title="מלונות"
        description="המלונות שחבילות הנופש מציעות. אפשרות מלון ביציאה מצביעה על המלון לפי הקוד שלו, והאתר מציג משם את השם, התמונות והתיאור."
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
