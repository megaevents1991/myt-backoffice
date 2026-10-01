import { PageHeader } from "@/components/page-header";
import { getCompanySettings } from "@/lib/actions/tours-settings-actions";
import { CompanySettingsFormEditor } from "@/components/tours/content/company-settings-form";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { LoadError } from "@/components/tours/content/save-bar";

export const dynamic = "force-dynamic";

export default async function TourCompanySettingsPage() {
  const result = await getCompanySettings();
  return (
    <div dir="rtl">
      <PageHeader
        title="הגדרות חברה"
        description="הפרטים של החברה הפעילה: שם, אתר, פרטי קשר, מיתוג, אימייל, מדידה והחיבור שמפרסם את האתר. פתוח למנהל החברה בלבד."
        actions={result.success ? <PublishSiteButton /> : undefined}
      />
      {result.success ? (
        <CompanySettingsFormEditor key={result.data.slug} initial={result.data} />
      ) : (
        <LoadError message={result.error} />
      )}
    </div>
  );
}
