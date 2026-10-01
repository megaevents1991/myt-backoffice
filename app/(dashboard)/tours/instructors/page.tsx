import { PageHeader } from "@/components/page-header";
import { listTourInstructors } from "@/lib/actions/tours-content-actions";
import { InstructorsTable } from "@/components/tours/content/instructors";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { LoadError } from "@/components/tours/content/save-bar";

export const dynamic = "force-dynamic";

export default async function TourInstructorsPage() {
  const result = await listTourInstructors();
  return (
    <div dir="rtl">
      <PageHeader
        title="מלווי קבוצות"
        description="המלווים שמוצגים באתר, לפי הסדר שבו הם מופיעים שם. לכל מלווה עמוד עם תמונה, יעדי הדרכה, תוכן וגלריה."
        actions={<PublishSiteButton />}
      />
      {result.success ? (
        <InstructorsTable rows={result.data.rows} siteUrl={result.data.siteUrl} />
      ) : (
        <LoadError message={result.error} />
      )}
    </div>
  );
}
