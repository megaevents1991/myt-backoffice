import { listTourMedia } from "@/lib/actions/tours-media-actions";
import { MediaScreen } from "@/components/tours/content/media-screen";
import { PageLoadError } from "@/components/tours/content/save-bar";

export const dynamic = "force-dynamic";

/** The media library of the company's site (Website > Media). */
export default async function TourMediaPage() {
  const result = await listTourMedia();
  if (!result.success) return <PageLoadError message={result.error} />;
  return <MediaScreen files={result.data.files} truncated={result.data.truncated} />;
}
