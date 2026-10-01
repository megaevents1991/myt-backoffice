import { getTourTerm } from "@/lib/actions/tours-content-actions";
import { PageLoadError } from "@/components/tours/content/save-bar";
import { TermFormEditor } from "@/components/tours/content/term-form";

export const dynamic = "force-dynamic";

export default async function TourTermPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getTourTerm(id);
  if (!result.success) {
    return <PageLoadError message={result.error} backHref="/tours/terms" backLabel="Back to Categories & Tags" />;
  }
  return <TermFormEditor key={result.data.id} initial={result.data} />;
}
