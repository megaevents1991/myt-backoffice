import { requireCompany } from "@/lib/company";
import type { SessionPayload } from "@/lib/auth/session";
import { isManagerRole } from "@/components/tours/flights/block-rules";
import { PageHeader } from "@/components/page-header";
import { NotAToursCompany } from "@/components/tours/not-a-tours-company";
import { ToursDashboard } from "@/components/tours/dashboard/tours-dashboard";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";

// Per request always: the guard reads cookies, and its refusal is caught below -
// a build-time prerender must never bake the "not a tours company" notice in.
export const dynamic = "force-dynamic";

/**
 * /tours - the dashboard of a company that sells tours (Mega Family): the
 * Mega Events dashboard's sections, filled with tours, reservations and leads.
 */
export default async function ToursDashboardPage() {
  let session: SessionPayload;
  try {
    ({ session } = await requireCompany("tours"));
  } catch (e) {
    // The active company does not sell tours (Mega Events) - say so, do not crash.
    // Anything else (no staff session) goes to the dashboard error boundary like on every guarded page.
    if (e instanceof Error && e.message.includes("does not sell")) {
      return (
        <NotAToursCompany description="The tours dashboard opens only while the active company sells tours. If you have access to one, switch to it from the company switcher in the top bar." />
      );
    }
    throw e;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Tours, reservations and leads at a glance. Every number opens the screen that holds its rows."
        actions={<PublishSiteButton />}
      />
      <ToursDashboard isManager={isManagerRole(session.role)} />
    </div>
  );
}
