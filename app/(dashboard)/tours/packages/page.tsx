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
    <div dir="rtl">
      <PageHeader
        title="עמודי טיולים"
        description="כל עמוד כאן הוא עמוד מוצר באתר: שם, תמונות, תיאור, מסלול יומי ושאלות נפוצות. הסדרות והיציאות נמכרות על העמוד. שינוי מגיע לאתר אחרי שמירה ופרסום."
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
