import { getHomepageEditor } from "@/lib/actions/tours-site-actions";
import { PageLoadError } from "@/components/tours/content/save-bar";
import { HomepageEditor } from "@/components/tours/site/homepage-editor";

export const dynamic = "force-dynamic";

/** The home page of the company's site: its sections, in order (Website > Homepage). */
export default async function TourHomepagePage() {
  const result = await getHomepageEditor();
  if (!result.success) return <PageLoadError message={result.error} />;
  return <HomepageEditor initial={result.data.doc} options={result.data.options} />;
}
