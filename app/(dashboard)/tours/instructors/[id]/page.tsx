import { getTourInstructor } from "@/lib/actions/tours-content-actions";
import { InstructorFormEditor } from "@/components/tours/content/instructors";
import { LoadError } from "@/components/tours/content/save-bar";

export const dynamic = "force-dynamic";

export default async function TourInstructorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getTourInstructor(id);
  if (!result.success) {
    return <LoadError message={result.error} backHref="/tours/instructors" backLabel="Back to Group Leaders" />;
  }
  return <InstructorFormEditor key={result.data.id} initial={result.data} />;
}
