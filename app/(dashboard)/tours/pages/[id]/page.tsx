import { getTourCmsPage } from "@/lib/actions/tours-content-actions";
import { CmsPageFormEditor } from "@/components/tours/content/cms-pages";
import { LoadError } from "@/components/tours/content/save-bar";

export const dynamic = "force-dynamic";

export default async function TourCmsPagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getTourCmsPage(id);
  if (!result.success) {
    return <LoadError message={result.error} backHref="/tours/pages" backLabel="Back to Content Pages" />;
  }
  return <CmsPageFormEditor key={result.data.id} initial={result.data} />;
}
