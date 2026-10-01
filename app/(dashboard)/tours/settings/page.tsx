import { PageHeader } from "@/components/page-header";
import { getCompanySettings } from "@/lib/actions/tours-settings-actions";
import { CompanySettingsFormEditor } from "@/components/tours/content/company-settings-form";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { LoadError } from "@/components/tours/content/save-bar";

export const dynamic = "force-dynamic";

export default async function TourCompanySettingsPage() {
  const result = await getCompanySettings();
  return (
    <div>
      <PageHeader
        title="Settings"
        description="Details of the active company: name, site, contact details, brand, email, analytics, the connection that publishes the site, and members. Company admins only."
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
