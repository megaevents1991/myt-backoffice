import { PageHeader } from "@/components/page-header";
import { listTourCmsPages } from "@/lib/actions/tours-content-actions";
import { CmsPagesTable } from "@/components/tours/content/cms-pages";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { LoadError } from "@/components/tours/content/save-bar";

export const dynamic = "force-dynamic";

export default async function TourCmsPagesPage() {
  const result = await listTourCmsPages();
  return (
    <div dir="rtl">
      <PageHeader
        title="עמודי תוכן"
        description="העמודים החופשיים של האתר: אודות, שאלות נפוצות, תקנון, צור קשר והפוסטים. כתובת העמוד קבועה; עורכים את הכותרת, התוכן וה-SEO."
        actions={<PublishSiteButton />}
      />
      {result.success ? <CmsPagesTable rows={result.data} /> : <LoadError message={result.error} />}
    </div>
  );
}
