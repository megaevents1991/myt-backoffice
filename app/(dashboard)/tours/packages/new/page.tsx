import { getNewTourContext } from "@/lib/actions/tours-content-actions";
import { CreateTour } from "@/components/tours/content/create-tour";
import { PageLoadError } from "@/components/tours/content/save-bar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create Tour" };

/** Create Tour - the tours side of /events/new. */
export default async function NewTourPage() {
  const result = await getNewTourContext();
  if (!result.success) {
    return <PageLoadError message={result.error} backHref="/tours/packages" backLabel="Back to Tours" />;
  }
  return <CreateTour context={result.data} />;
}
