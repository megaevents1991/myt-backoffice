import { PageHeader } from "@/components/page-header";
import { listTourTerms } from "@/lib/actions/tours-content-actions";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { LoadError } from "@/components/tours/content/save-bar";
import { TermsTable } from "@/components/tours/content/terms-table";

export const dynamic = "force-dynamic";

export default async function TourTermsPage() {
  const result = await listTourTerms();
  return (
    <div dir="rtl">
      <PageHeader
        title="קטגוריות ותגיות"
        description="היעדים, קהלי היעד, התגיות ושאר הקטגוריות שהאתר מסנן ומקבץ לפיהן. לכל קטגוריה עמוד באתר עם שם, תיאור ותמונות ראש."
        actions={<PublishSiteButton />}
      />
      {result.success ? <TermsTable rows={result.data} /> : <LoadError message={result.error} />}
    </div>
  );
}
