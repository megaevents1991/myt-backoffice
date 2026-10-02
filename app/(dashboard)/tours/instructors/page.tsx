import { PageHeader } from "@/components/page-header";
import { listTourInstructors } from "@/lib/actions/tours-content-actions";
import { AddInstructorButton, InstructorsTable } from "@/components/tours/content/instructors";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { PageLoadError } from "@/components/tours/content/save-bar";

export const dynamic = "force-dynamic";

export default async function TourInstructorsPage() {
  const result = await listTourInstructors();
  return (
    <div>
      <PageHeader
        title="Group Leaders"
        description="The group leaders shown on the site, in the order they appear there. Each one has a page with a photo, destinations, content and a gallery."
        actions={
          <>
            <PublishSiteButton />
            {result.success && <AddInstructorButton />}
          </>
        }
      />
      {result.success ? (
        <InstructorsTable rows={result.data.rows} siteUrl={result.data.siteUrl} />
      ) : (
        <PageLoadError message={result.error} />
      )}
    </div>
  );
}
