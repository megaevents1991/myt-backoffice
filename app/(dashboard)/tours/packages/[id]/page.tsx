import { Suspense } from "react";

import { getTourPackage } from "@/lib/actions/tours-content-actions";
import { PackageEditor } from "@/components/tours/content/package-editor";
import { LoadError } from "@/components/tours/content/save-bar";

export const dynamic = "force-dynamic";

export default async function TourPackagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getTourPackage(id);
  if (!result.success) {
    return <LoadError message={result.error} backHref="/tours/packages" backLabel="כל עמודי הטיולים" />;
  }
  return (
    <Suspense>
      <PackageEditor key={result.data.id} initial={result.data} />
    </Suspense>
  );
}
