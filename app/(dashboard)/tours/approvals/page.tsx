import { requireCompany, type Company } from "@/lib/company";
import type { SessionPayload } from "@/lib/auth/session";
import { isManagerRole } from "@/components/tours/flights/block-rules";
import { ApprovalsScreen } from "@/components/tours/approvals/approvals-screen";
import { ManagersOnly } from "@/components/tours/approvals/notices";
import { NotAToursCompany } from "@/components/tours/not-a-tours-company";

// Per request always: the guard reads cookies, and its refusal is caught below -
// a build-time prerender must never bake one of the two notices in.
export const dynamic = "force-dynamic";

/**
 * /tours/approvals ("Approvals") - what waits for a person in a tours
 * company: approvals only a manager gives, and data the import could not
 * settle on its own. Company manager (`admin`) and `superadmin` only; the
 * server actions behind the screen check the same thing again.
 */
export default async function TourApprovalsPage() {
  let session: SessionPayload;
  let company: Company;
  try {
    ({ session, company } = await requireCompany("tours"));
  } catch (e) {
    // The active company does not sell tours (Mega Events) - say so, do not crash.
    // Anything else (no staff session) goes to the dashboard error boundary like on every guarded page.
    if (e instanceof Error && e.message.includes("does not sell")) {
      return (
        <NotAToursCompany description="Approvals are available only when the active company sells tours. If you have access to such a company, switch to it from the company picker in the top bar." />
      );
    }
    throw e;
  }
  if (!isManagerRole(session.role)) return <ManagersOnly />;

  return <ApprovalsScreen companyName={company.name} />;
}
