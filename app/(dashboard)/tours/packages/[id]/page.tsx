import { Suspense } from "react";

import { getTourPackage } from "@/lib/actions/tours-content-actions";
import { PackageEditor } from "@/components/tours/content/package-editor";
import { PageLoadError } from "@/components/tours/content/save-bar";
import { TourFooterTilesCard } from "@/components/tours/site/tour-footer-tiles";

export const dynamic = "force-dynamic";

export default async function TourPackagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getTourPackage(id);
  if (!result.success) {
    return <PageLoadError message={result.error} backHref="/tours/packages" backLabel="Back to Tours" />;
  }
  return (
    <>
      <Suspense>
        <PackageEditor key={result.data.id} initial={result.data} />
      </Suspense>
      {/* its own card with its own save: the choice is not part of the tour form */}
      <TourFooterTilesCard key={`tiles-${result.data.id}`} packageId={result.data.id} />
    </>
  );
}
