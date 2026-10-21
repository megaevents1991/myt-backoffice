import { PageHeader } from "@/components/page-header";
import { getCompanySettings } from "@/lib/actions/tours-settings-actions";
import { getWhatsappSettings } from "@/lib/actions/whatsapp-settings-actions";
import { CompanySettingsFormEditor } from "@/components/tours/content/company-settings-form";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { WhatsappCard } from "@/components/tours/content/whatsapp-card";
import { PageLoadError } from "@/components/tours/content/save-bar";

export const dynamic = "force-dynamic";

export default async function TourCompanySettingsPage() {
  const result = await getCompanySettings();
  // the WhatsApp card loads apart: a failure there prints under the form, never instead of it
  const whatsapp = result.success ? await getWhatsappSettings() : null;
  return (
    <div>
      <PageHeader
        title="Settings"
        description="Details of the active company: name, site, contact details, brand, email, analytics and the connection that publishes the site. People and roles are managed in Users. Company admins only."
        actions={result.success ? <PublishSiteButton /> : undefined}
      />
      {result.success ? (
        <div className="space-y-6">
          <CompanySettingsFormEditor key={result.data.slug} initial={result.data} />
          {whatsapp && (whatsapp.success ? <WhatsappCard initial={whatsapp.data} /> : <PageLoadError message={whatsapp.error} />)}
        </div>
      ) : (
        <PageLoadError message={result.error} />
      )}
    </div>
  );
}
