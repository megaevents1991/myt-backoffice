import { Suspense } from "react";
import { cookies } from "next/headers";
import { DeparturesBoard } from "@/components/tours/departures/departures-board";
import { getSession } from "@/lib/auth/guards";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/auth/session";
import { TOURS_AGENT_ROLE } from "@/types/auth.types";

export const metadata = { title: "לוח יציאות" };

/**
 * Departures board of the active company (product type "tours"). The board
 * loads its own data through server actions, so switching company or year
 * never needs a full page render. Suspense: the board reads the query string.
 *
 * A sales agent of the company (role tours_agent) gets the same board read
 * only. The flag below only tells the board what to draw from the first
 * paint; what that viewer may read and that it may change nothing are decided
 * by the server actions (requireCompanyViewer / requireCompany).
 *
 * The role is the live one, else the one the cookie was signed with: a
 * disabled agent has no live session, and must still see the agent's screen
 * (with the server's refusal in it), not the staff one.
 */
export default async function ToursDeparturesPage() {
  const live = await getSession();
  const signed = live ? null : await verifySessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  const role = (live ?? signed)?.role;
  return (
    <Suspense fallback={null}>
      <DeparturesBoard readOnly={role === TOURS_AGENT_ROLE} />
    </Suspense>
  );
}
