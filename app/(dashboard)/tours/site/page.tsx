import { getChromeEditor } from "@/lib/actions/tours-site-actions";
import { PageLoadError } from "@/components/tours/content/save-bar";
import { ChromeEditor } from "@/components/tours/site/chrome-editor";

export const dynamic = "force-dynamic";

/** The header menus, the footer and the contact details of the company's site (Website > Header & Footer). */
export default async function TourSiteChromePage() {
  const result = await getChromeEditor();
  if (!result.success) return <PageLoadError message={result.error} />;
  const { general, header, footer, options } = result.data;
  return <ChromeEditor initial={{ general, header, footer }} options={options} />;
}
